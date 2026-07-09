import { useRaceStore } from '@/store/raceStore';
import { TimingEngine, type SensorHit } from './timingEngine';

interface SimCar {
  username: string;
  sensorIndex: number;
  progressToNext: number; // 0 to 1
  baseSpeed: number;
  inPitlane: boolean;
}

export class Simulator {
  private static intervalId: number | null = null;
  private static batchedHits: SensorHit[] = [];
  private static cars: SimCar[] = [];

  static start() {
    if (this.intervalId !== null) return;
    
    // Initialize cars from whitelist
    const store = useRaceStore.getState();
    this.cars = store.whitelist.map((w, i) => ({
      username: w.username,
      sensorIndex: 0,
      progressToNext: -i * 0.2, // Stagger start
      baseSpeed: 0.05 + Math.random() * 0.01, // 5-6% per tick
      inPitlane: false,
    }));

    // Start 100ms tick for physics, 2000ms tick for batch emit
    this.intervalId = window.setInterval(() => this.tick(), 100);
    
    // Emit batch every 2 seconds
    window.setInterval(() => {
      if (this.batchedHits.length > 0) {
        TimingEngine.processBatch(this.batchedHits);
        this.batchedHits = [];
      }
    }, 2000);
  }

  static stop() {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private static tick() {
    const store = useRaceStore.getState();
    if (!store.sensorsActive) return;

    if (store.sessionEndTime && Date.now() >= store.sessionEndTime) {
      store.setSensorsActive(false);
      store.addLog({ timestamp: Date.now(), message: 'Session time limit reached. Sensors deactivated.', type: 'SYSTEM' }, store.sessionType);
      return;
    }

    // Reconcile cars with whitelist dynamically
    const whitelistUsernames = store.whitelist.map(w => w.username);
    this.cars = this.cars.filter(c => whitelistUsernames.includes(c.username));
    
    const existingUsernames = this.cars.map(c => c.username);
    store.whitelist.forEach((w, i) => {
      if (!existingUsernames.includes(w.username)) {
        this.cars.push({
          username: w.username,
          sensorIndex: 0,
          progressToNext: -i * 0.2, // Stagger start
          baseSpeed: 0.05 + Math.random() * 0.01,
          inPitlane: false,
        });
      }
    });

    const { trackLayout, flagStatus } = store;
    const { sensors, pitlaneStartSensor } = trackLayout;
    
    if (sensors.length === 0) return;

    let speedMultiplier = 1.0;
    if (flagStatus === 'YELLOW') speedMultiplier = 0.6;
    if (flagStatus === 'RED') speedMultiplier = 0.2;

    this.cars.forEach(car => {
      // Don't move if finished
      const driverState = store.drivers[car.username];
      if (driverState?.status === 'FINISHED') return;

      if (car.progressToNext < 0) {
        // Wait for start
        car.progressToNext += car.baseSpeed * speedMultiplier;
        return;
      }

      // Add randomness for overtakes
      const tickSpeed = car.baseSpeed * speedMultiplier * (0.9 + Math.random() * 0.2);
      car.progressToNext += tickSpeed;

      if (car.progressToNext >= 1.0) {
        car.progressToNext -= 1.0;
        car.sensorIndex = (car.sensorIndex + 1) % sensors.length;
        
        const sensorId = sensors[car.sensorIndex];

        // Simulate pitlane entry (5% chance under green, 50% under red)
        if (sensorId === pitlaneStartSensor && !car.inPitlane) {
            const pitChance = flagStatus === 'RED' ? 0.5 : 0.05;
            if (Math.random() < pitChance) {
                car.inPitlane = true;
            }
        }

        // Emit hit
        this.batchedHits.push({
          username: car.username,
          sensorId: sensorId,
          timestamp: Date.now()
        });

        // If post pitlane, exit pit
        if (car.inPitlane && sensorId === trackLayout.postPitlaneSensor) {
            car.inPitlane = false;
        }
      }
    });
  }
}
