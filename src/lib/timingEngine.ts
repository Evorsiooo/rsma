import { useRaceStore, type DriverState } from '@/store/raceStore';

export interface SensorHit {
  username: string;
  sensorId: number;
  timestamp: number;
}

export class TimingEngine {
  private static readonly TIMEOUT_MS = 5000;

  static processBatch(hits: SensorHit[]) {
    // Broadcast hits to the debugger/wizard
    import('../store/sensorDebuggerStore').then(m => m.useSensorDebuggerStore.getState().addHits(hits));

    const store = useRaceStore.getState();
    if (!store.sensorsActive) return;

    const { trackLayout, drivers, sessionType, lapCount } = store;
    const { sensors, pitlaneStartSensor, postPitlaneSensor } = trackLayout;

    if (sensors.length === 0) return; // No track layout

    // Determine if session is active for recording lap times
    const isSessionActive = store.sessionStartTime !== null;
    
    // Sort hits by timestamp to process chronologically
    const sortedHits = [...hits].sort((a, b) => a.timestamp - b.timestamp);
    if (sortedHits.length === 0) return;

    // Deep clone drivers for atomic updates
    const localDrivers: Record<string, DriverState> = JSON.parse(JSON.stringify(drivers));
    const newlyFinished: string[] = [];

    for (const hit of sortedHits) {
      const driver = localDrivers[hit.username];
      if (!driver) continue; // Not whitelisted

      // Skip if finished or DNFed
      if (driver.status === 'FINISHED' || driver.status === 'DNF') continue;

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
      driver.lastSensorId = hit.sensorId;
      driver.lastSensorTime = now;
      driver.status = 'TRACK';

      if (isPitlaneEntry) {
        driver.inPitlane = true;
        driver.status = 'PITS';
      } else if (isPitlaneExit || currentIndex !== -1) {
        driver.inPitlane = false;
        driver.status = 'TRACK';
      }

      // Lap completion logic (crossing sensor 0)
      if (hit.sensorId === sensors[0]) {
        if (isSessionActive && driver.currentLapStartTime !== null) {
          const lapTime = now - driver.currentLapStartTime;
          
          // Only record if it's a valid racing lap (post-session-start)
          if (driver.currentLapStartTime >= store.sessionStartTime!) {
            driver.lastLapTime = lapTime;
            
            if (driver.bestLapTime === null || lapTime < driver.bestLapTime) {
              driver.bestLapTime = lapTime;
              
              if (sessionType !== 'RACE') {
                store.addLog({
                  timestamp: now,
                  message: `${hit.username} set a new personal best: ${(lapTime/1000).toFixed(3)}s`,
                  type: 'LAP_COMPLETED'
                });
              }
            }

            driver.lapsCompleted = driver.lapsCompleted + 1;

            if (sessionType === 'RACE') {
              store.addLog({
                timestamp: now,
                message: `${hit.username} completed lap ${driver.lapsCompleted} in ${(lapTime/1000).toFixed(3)}s`,
                type: 'LAP_COMPLETED'
              });

              // Recalculate leader locally to determine if race should end for this driver
              let localLeader = null;
              let maxLaps = 0;
              for (const d of Object.values(localDrivers)) {
                if (d.lapsCompleted > maxLaps) {
                  maxLaps = d.lapsCompleted;
                  localLeader = d;
                }
              }
              const raceEnded = localLeader && localLeader.status === 'FINISHED';

              if (driver.lapsCompleted >= lapCount || raceEnded) {
                driver.status = 'FINISHED';
                newlyFinished.push(driver.username);
              }
            }
          }
        }
        
        // Reset current lap time when crossing line, regardless of session active
        driver.currentLapStartTime = now;
      }
    }

    // After processing batch, recalculate leaderboard and intervals atomically
    const newLeaderboard = this.recalculateLeaderboard(localDrivers, store);

    // Now emit finishing logs if any
    for (const username of newlyFinished) {
      const pos = newLeaderboard.indexOf(username) + 1;
      const msg = `${username} has finished the race in P${pos}!`;
      store.addLog({
        timestamp: Date.now(),
        message: msg,
        type: 'MESSAGE'
      });
      // Ensure it triggers TTS in UI by using MESSAGE type
    }

    // Atomic update with stale-state rejection (robust against multi-tab or HMR leaks)
    useRaceStore.setState((state) => {
      const mergedDrivers = { ...state.drivers };
      for (const username in localDrivers) {
        const local = localDrivers[username];
        const current = mergedDrivers[username];
        
        // Reject stale updates from concurrent tabs or ghost intervals
        if (current && current.lastSensorTime && local.lastSensorTime && local.lastSensorTime < current.lastSensorTime) {
          continue;
        }
        
        // Never revert a FINISHED status from a delayed batch
        if (current?.status === 'FINISHED' && local.status !== 'FINISHED') {
          local.status = 'FINISHED'; // keep it finished
        }
        
        mergedDrivers[username] = local;
      }
      return { 
        drivers: mergedDrivers,
        leaderboard: newLeaderboard 
      };
    });
  }

  private static recalculateLeaderboard(localDrivers: Record<string, DriverState>, store: any): string[] {
    const { trackLayout, sessionType, leaderboard: oldLeaderboard } = store;
    const driverNames = Object.keys(localDrivers);
    let newLeaderboard: string[] = [...driverNames];

    if (sessionType === 'QUALIFYING' || sessionType === 'PRACTICE') {
      newLeaderboard.sort((a, b) => this.compareQualiDrivers(localDrivers[a], localDrivers[b]));
    } else {
      newLeaderboard.sort((a, b) => this.compareRaceDrivers(localDrivers[a], localDrivers[b], trackLayout.sensors));
      this.calculateIntervals(newLeaderboard, localDrivers, trackLayout.sensors);
      this.detectOvertakes(newLeaderboard, oldLeaderboard, store);
    }

    return newLeaderboard;
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

  private static calculateIntervals(leaderboard: string[], drivers: Record<string, DriverState>, sensors: number[]) {
    if (sensors.length === 0) return;
    
    for (let i = 0; i < leaderboard.length; i++) {
      const current = drivers[leaderboard[i]];
      if (i === 0) {
        current.intervalToAhead = 0;
        current.gapToLeader = 0;
        continue;
      }
      
      const ahead = drivers[leaderboard[i - 1]];
      const leader = drivers[leaderboard[0]];
      
      const currentPos = (current.lapsCompleted * sensors.length) + (current.lastSensorId ? sensors.indexOf(current.lastSensorId) : 0);
      const aheadPos = (ahead.lapsCompleted * sensors.length) + (ahead.lastSensorId ? sensors.indexOf(ahead.lastSensorId) : 0);
      const leaderPos = (leader.lapsCompleted * sensors.length) + (leader.lastSensorId ? sensors.indexOf(leader.lastSensorId) : 0);

      // Assume roughly 2 seconds per sensor gap
      const rawInterval = ((aheadPos - currentPos) * 2000) + ((current.lastSensorTime || 0) - (ahead.lastSensorTime || 0));
      const rawGap = ((leaderPos - currentPos) * 2000) + ((current.lastSensorTime || 0) - (leader.lastSensorTime || 0));

      current.intervalToAhead = rawInterval > 0 ? rawInterval : Math.abs((current.lastSensorTime || 0) - (ahead.lastSensorTime || 0));
      current.gapToLeader = rawGap > 0 ? rawGap : Math.abs((current.lastSensorTime || 0) - (leader.lastSensorTime || 0));
    }
  }

  private static detectOvertakes(newLeaderboard: string[], oldLeaderboard: string[], store: any) {
    if (oldLeaderboard.length === 0) return;
    
    newLeaderboard.forEach((username, currentIndex) => {
        const previousIndex = oldLeaderboard.indexOf(username);
        if (previousIndex !== -1 && currentIndex < previousIndex) {
            // Find all drivers who were ahead of 'username' before, but are behind 'username' now
            for (let i = 0; i < previousIndex; i++) {
                const driverAheadBefore = oldLeaderboard[i];
                const newIndexOfDriver = newLeaderboard.indexOf(driverAheadBefore);
                
                // If they were ahead before, but are now behind (or dropped out), it's an overtake
                if (newIndexOfDriver > currentIndex || newIndexOfDriver === -1) {
                    store.addLog({
                        timestamp: Date.now(),
                        message: `${username} overtook ${driverAheadBefore} for P${currentIndex + 1}`,
                        type: 'OVERTAKE'
                    }, 'RACE');
                }
            }
        }
    });
  }
}
