import { useRaceStore, type DriverState } from '@/store/raceStore';

export interface SensorHit {
  username: string;
  sensorId: number;
  timestamp: number;
}

export class TimingEngine {
  private static readonly TIMEOUT_MS = 5000;

  static processBatch(hits: SensorHit[]) {
    const store = useRaceStore.getState();
    if (!store.sensorsActive) return;

    const { trackLayout, drivers, sessionType, lapCount } = store;
    const { sensors, pitlaneStartSensor, postPitlaneSensor } = trackLayout;

    if (sensors.length === 0) return; // No track layout

    // Sort hits by timestamp to process chronologically
    const sortedHits = [...hits].sort((a, b) => a.timestamp - b.timestamp);

    // STRICT GUARD: Do not process hits if a session is not officially active
    if (store.sessionStartTime === null) return;
    
    // We only process hits that happen AFTER the session start time
    const validHits = sortedHits.filter(h => h.timestamp >= store.sessionStartTime!);
    if (validHits.length === 0) return;

    for (const hit of validHits) {
      const driver = drivers[hit.username];
      if (!driver) continue; // Not whitelisted

      // Skip if finished
      if (driver.status === 'FINISHED') continue;

      const currentIndex = sensors.indexOf(hit.sensorId);
      const isPitlaneEntry = hit.sensorId === pitlaneStartSensor;
      const isPitlaneExit = hit.sensorId === postPitlaneSensor;

      // Handle invalid sensors
      if (currentIndex === -1 && !isPitlaneEntry && !isPitlaneExit) continue;

      const now = hit.timestamp;
      const timeSinceLastHit = driver.lastSensorTime ? now - driver.lastSensorTime : Infinity;
      
      let expectedNextSensor: number | null = null;
      if (driver.lastSensorId !== null) {
        if (driver.inPitlane && postPitlaneSensor !== null) {
          expectedNextSensor = postPitlaneSensor;
        } else {
          const lastIndex = sensors.indexOf(driver.lastSensorId);
          if (lastIndex !== -1) {
            expectedNextSensor = sensors[(lastIndex + 1) % sensors.length];
          }
        }
      }

      const isValidSequence = expectedNextSensor === hit.sensorId;
      const isTimeoutRecovery = timeSinceLastHit > this.TIMEOUT_MS;

      if (!isValidSequence && !isTimeoutRecovery && driver.lastSensorId !== null) {
        // Ignore this hit, it's either a misfire or they went backwards without a 5s timeout
        continue;
      }

      // Valid hit (either sequential, or recovery from 5s timeout, or first hit)
      const updates: Partial<DriverState> = {
        lastSensorId: hit.sensorId,
        lastSensorTime: now,
        status: 'TRACK'
      };

      if (isPitlaneEntry) {
        updates.inPitlane = true;
        updates.status = 'PITS';
      } else if (isPitlaneExit || currentIndex !== -1) {
        updates.inPitlane = false;
        updates.status = 'TRACK';
      }

      // Lap completion logic (crossing sensor 0)
      if (hit.sensorId === sensors[0]) {
        if (driver.currentLapStartTime !== null) {
          const lapTime = now - driver.currentLapStartTime;
          updates.lastLapTime = lapTime;
          
          if (driver.bestLapTime === null || lapTime < driver.bestLapTime) {
            updates.bestLapTime = lapTime;
          }

          updates.lapsCompleted = driver.lapsCompleted + 1;

          store.addLog({
            timestamp: now,
            message: `${hit.username} completed lap ${updates.lapsCompleted} in ${(lapTime/1000).toFixed(3)}s`,
            type: 'LAP_COMPLETED'
          });

          // Check for finish
          if (sessionType === 'RACE') {
            // Is this driver the leader who just finished the race, or is the race already finished by someone else?
            // We check the leaderboard to see if anyone has hit lapCount. But we update state after.
            // A simple way: if they reach lapCount, they are finished. If the leader reached lapCount, 
            // everyone else finishes on the lap they are currently on when crossing the line.
            
            const leader = store.leaderboard.length > 0 ? drivers[store.leaderboard[0]] : null;
            const raceEnded = leader && leader.status === 'FINISHED';

            if (updates.lapsCompleted >= lapCount || raceEnded) {
              updates.status = 'FINISHED';
            }
          }
        }
        updates.currentLapStartTime = now;
      }

      store.updateDriverState(hit.username, updates);
    }

    // After processing batch, recalculate leaderboard and intervals
    this.recalculateLeaderboard();
  }

  private static recalculateLeaderboard() {
    const store = useRaceStore.getState();
    const { drivers, trackLayout, sessionType, leaderboard: oldLeaderboard } = store;
    const driverNames = Object.keys(drivers);
    let newLeaderboard: string[] = [...driverNames];

    if (sessionType === 'QUALIFYING') {
      newLeaderboard.sort((a, b) => this.compareQualiDrivers(drivers[a], drivers[b]));
    } else {
      newLeaderboard.sort((a, b) => this.compareRaceDrivers(drivers[a], drivers[b], trackLayout.sensors));
      this.calculateIntervals(newLeaderboard, drivers, trackLayout.sensors, store);
      this.detectOvertakes(newLeaderboard, oldLeaderboard, store);
    }

    store.setLeaderboard(newLeaderboard);
  }

  private static compareQualiDrivers(d1: DriverState, d2: DriverState): number {
    if (d1.bestLapTime && d2.bestLapTime) return d1.bestLapTime - d2.bestLapTime;
    if (d1.bestLapTime) return -1;
    if (d2.bestLapTime) return 1;
    return 0;
  }

  private static compareRaceDrivers(d1: DriverState, d2: DriverState, sensors: number[]): number {
    // 1. Finished drivers are sorted by who finished first
    if (d1.status === 'FINISHED' && d2.status !== 'FINISHED') return -1;
    if (d2.status === 'FINISHED' && d1.status !== 'FINISHED') return 1;
    if (d1.status === 'FINISHED' && d2.status === 'FINISHED') {
        if (d1.lapsCompleted !== d2.lapsCompleted) return d2.lapsCompleted - d1.lapsCompleted;
        return (d1.lastSensorTime || 0) - (d2.lastSensorTime || 0);
    }

    // 2. Sort by laps completed
    if (d1.lapsCompleted !== d2.lapsCompleted) return d2.lapsCompleted - d1.lapsCompleted;

    // 3. Sort by track position (sensor index)
    let idx1 = d1.lastSensorId ? sensors.indexOf(d1.lastSensorId) : -1;
    let idx2 = d2.lastSensorId ? sensors.indexOf(d2.lastSensorId) : -1;
    if (idx1 !== idx2) return idx2 - idx1;

    // 4. Sort by time they hit the last sensor (lower time = hit it first = ahead)
    return (d1.lastSensorTime || 0) - (d2.lastSensorTime || 0);
  }

  private static calculateIntervals(leaderboard: string[], drivers: Record<string, DriverState>, sensors: number[], store: any) {
    if (sensors.length === 0) return;
    
    for (let i = 0; i < leaderboard.length; i++) {
      const current = drivers[leaderboard[i]];
      if (i === 0) {
        store.updateDriverState(leaderboard[i], { intervalToAhead: 0, gapToLeader: 0 });
        continue;
      }
      
      const ahead = drivers[leaderboard[i - 1]];
      const leader = drivers[leaderboard[0]];
      
      const currentPos = (current.lapsCompleted * sensors.length) + (current.lastSensorId ? sensors.indexOf(current.lastSensorId) : 0);
      const aheadPos = (ahead.lapsCompleted * sensors.length) + (ahead.lastSensorId ? sensors.indexOf(ahead.lastSensorId) : 0);
      const leaderPos = (leader.lapsCompleted * sensors.length) + (leader.lastSensorId ? sensors.indexOf(leader.lastSensorId) : 0);

      // Assume roughly 2 seconds per sensor gap
      const interval = ((aheadPos - currentPos) * 2000) + ((current.lastSensorTime || 0) - (ahead.lastSensorTime || 0));
      const gap = ((leaderPos - currentPos) * 2000) + ((current.lastSensorTime || 0) - (leader.lastSensorTime || 0));

      store.updateDriverState(leaderboard[i], { 
        intervalToAhead: Math.max(0, interval), 
        gapToLeader: Math.max(0, gap) 
      });
    }
  }

  private static detectOvertakes(newLeaderboard: string[], oldLeaderboard: string[], store: any) {
    if (oldLeaderboard.length === 0) return;
    
    newLeaderboard.forEach((username, currentIndex) => {
        const previousIndex = oldLeaderboard.indexOf(username);
        if (previousIndex !== -1 && currentIndex < previousIndex) {
            // Driver moved up
            for (let i = currentIndex + 1; i <= previousIndex; i++) {
                const overtaken = oldLeaderboard[i-1];
                store.addLog({
                    timestamp: Date.now(),
                    message: `${username} overtook ${overtaken} for P${currentIndex + 1}`,
                    type: 'OVERTAKE'
                }, 'RACE');
            }
        }
    });
  }
}
