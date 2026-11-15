using UnityEngine;

public class SpectralSimulation : MonoBehaviour
{
    private int trialCount = 0;
    private bool anomalyInjected = false;
    public int atomicNumber = 1; // Hydrogen

    public float CalculateEnergy(int n)
    {
        return (float)(-13.6 * (Mathf.Pow(atomicNumber, 2) / Mathf.Pow(n, 2)));
    }

    public float PredictWavelength(int nInitial, int nFinal)
    {
        float energyInitial = CalculateEnergy(nInitial);
        float energyFinal = CalculateEnergy(nFinal);
        float deltaE = Mathf.Abs(energyFinal - energyInitial);
        return 1240f / deltaE; // Wavelength in nanometers
    }

    public (float measuredWavelength, bool isAnomaly) FirePhoton(int nInitial, int nFinal)
    {
        trialCount++;
        float expectedWavelength = PredictWavelength(nInitial, nFinal);
        float actualWavelength = expectedWavelength;
        bool isAnomaly = false;

        // Inject anomaly on the 4th trial
        if (trialCount == 4 && !anomalyInjected)
        {
            isAnomaly = true;
            anomalyInjected = true;
            actualWavelength = expectedWavelength * 1.15f; // Shift by 15%
        }

        return (Mathf.Round(actualWavelength * 100f) / 100f, isAnomaly);
    }
}