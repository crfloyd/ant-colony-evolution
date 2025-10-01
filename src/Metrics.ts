export class Metrics {
  private tripCount: number = 0;
  private totalTripDistance: number = 0;
  private timeForaging: number = 0;
  private timeReturning: number = 0;
  private foodCollected: number = 0;
  private startTime: number = Date.now();

  // Rolling window for rates
  private recentTrips: { time: number }[] = [];
  private recentFood: { time: number; amount: number }[] = [];
  private windowSize: number = 60000; // 1 minute window

  public recordTrip(distance: number): void {
    this.tripCount++;
    this.totalTripDistance += distance;
    this.recentTrips.push({ time: Date.now() });
    this.cleanOldData();
  }

  public recordFoodDelivery(amount: number): void {
    this.foodCollected += amount;
    this.recentFood.push({ time: Date.now(), amount });
    this.cleanOldData();
  }

  public recordStateTime(isForaging: boolean, deltaTime: number): void {
    if (isForaging) {
      this.timeForaging += deltaTime;
    } else {
      this.timeReturning += deltaTime;
    }
  }

  private cleanOldData(): void {
    const now = Date.now();
    const cutoff = now - this.windowSize;

    this.recentTrips = this.recentTrips.filter(t => t.time > cutoff);
    this.recentFood = this.recentFood.filter(f => f.time > cutoff);
  }

  public getTripsPerHour(): number {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const tripsInLastHour = this.recentTrips.filter(t => t.time > oneHourAgo).length;
    const minutesElapsed = Math.min(60, (now - this.startTime) / 60000);

    if (minutesElapsed < 1) return 0;
    return (tripsInLastHour / minutesElapsed) * 60;
  }

  public getAverageTripDistance(): number {
    if (this.tripCount === 0) return 0;
    return this.totalTripDistance / this.tripCount;
  }

  public getForagingPercentage(): number {
    const totalTime = this.timeForaging + this.timeReturning;
    if (totalTime === 0) return 0;
    return (this.timeForaging / totalTime) * 100;
  }

  public getReturningPercentage(): number {
    return 100 - this.getForagingPercentage();
  }

  public getFoodPerMinute(): number {
    const minutesElapsed = (Date.now() - this.startTime) / 60000;
    if (minutesElapsed < 0.1) return 0;

    const foodInLastMinute = this.recentFood.reduce((sum, f) => sum + f.amount, 0);
    return foodInLastMinute;
  }

  public getTotalFoodCollected(): number {
    return this.foodCollected;
  }

  public getTotalTrips(): number {
    return this.tripCount;
  }
}
