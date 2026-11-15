export class SpectralSimulation {
  private atomicNumber: number; // Z
  private trialCount: number;
  private anomalyInjected: boolean;

  constructor(initialZ: number = 1) {
    this.atomicNumber = initialZ; // Default to Hydrogen (Z=1)
    this.trialCount = 0;
    this.anomalyInjected = false;
  }

  // Bohr model energy: E = -13.6 * (Z^2 / n^2)
  public calculateEnergy(n: number): number {
    return -13.6 * (Math.pow(this.atomicNumber, 2) / Math.pow(n, 2));
  }

  // Rydberg formula for wavelength (in nm)
  public predictWavelength(nInitial: number, nFinal: number): number {
    if (nInitial <= nFinal) {
      throw new Error("Initial orbit must be higher than final orbit");
    }
    const energyInitial = this.calculateEnergy(nInitial);
    const energyFinal = this.calculateEnergy(nFinal);
    const deltaE = Math.abs(energyFinal - energyInitial);
    return 1240 / deltaE; // Wavelength in nanometers
  }

  // The Action (Firing the photon)
  public firePhoton(nInitial: number, nFinal: number): { measuredWavelength: number, isAnomaly: boolean } {
    this.trialCount++;
    const expectedWavelength = this.predictWavelength(nInitial, nFinal);
    
    let actualWavelength = expectedWavelength;
    let isAnomaly = false;

    // Inject the Anomaly on the 4th trial
    if (this.trialCount === 4 && !this.anomalyInjected) {
      isAnomaly = true;
      this.anomalyInjected = true;
      // Shift the wavelength by 15% to break the student's current model
      actualWavelength = expectedWavelength * 1.15; 
    }

    return {
      measuredWavelength: Number(actualWavelength.toFixed(2)),
      isAnomaly
    };
  }
  
  public setZ(newZ: number) {
    this.atomicNumber = newZ;
  }

  public getTrialCount(): number {
    return this.trialCount;
  }
}