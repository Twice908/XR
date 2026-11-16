// using UnityEngine;

// public class SpectralSimulation : MonoBehaviour
// {
//     private int trialCount = 0;
//     private bool anomalyInjected = false;
//     public int atomicNumber = 1; // Hydrogen

//     public float CalculateEnergy(int n)
//     {
//         return (float)(-13.6 * (Mathf.Pow(atomicNumber, 2) / Mathf.Pow(n, 2)));
//     }

//     public float PredictWavelength(int nInitial, int nFinal)
//     {
//         float energyInitial = CalculateEnergy(nInitial);
//         float energyFinal = CalculateEnergy(nFinal);
//         float deltaE = Mathf.Abs(energyFinal - energyInitial);
//         return 1240f / deltaE; // Wavelength in nanometers
//     }

//     public (float measuredWavelength, bool isAnomaly) FirePhoton(int nInitial, int nFinal)
//     {
//         trialCount++;
//         float expectedWavelength = PredictWavelength(nInitial, nFinal);
//         float actualWavelength = expectedWavelength;
//         bool isAnomaly = false;

//         // Inject anomaly on the 4th trial
//         if (trialCount == 4 && !anomalyInjected)
//         {
//             isAnomaly = true;
//             anomalyInjected = true;
//             actualWavelength = expectedWavelength * 1.15f; // Shift by 15%
//         }

//         return (Mathf.Round(actualWavelength * 100f) / 100f, isAnomaly);
//     }
// }

using MMAXR.Contracts;
using UnityEngine;

namespace MMAXR.Simulation
{
    public class SpectralSimulation : MonoBehaviour
    {
        [SerializeField] private Transform modelAnchor;

        // Runtime-populated — replaces the old initialZ / targetNInitial / targetNFinal constants.
        public int   AtomicNumber           { get; private set; }
        public int   NInitial               { get; private set; }
        public int   NFinal                 { get; private set; }
        public int   AnomalyTrialNumber     { get; private set; }
        public float AnomalyShiftMultiplier { get; private set; }

        private bool _configured;

        public void Configure(SimulationContract sim, GameObject loadedModel)
        {
            if (sim == null) { Debug.LogError("[Spectral] Null SimulationContract."); return; }

            AtomicNumber           = sim.AtomicNumber;
            NInitial               = sim.NInitial;
            NFinal                 = sim.NFinal;
            AnomalyTrialNumber     = sim.AnomalyTrialNumber;
            AnomalyShiftMultiplier = sim.AnomalyShiftMultiplier;

            if (loadedModel != null)
                loadedModel.transform.SetParent(modelAnchor != null ? modelAnchor : transform, false);

            _configured = true;
            Debug.Log($"[Spectral] Configured: Z={AtomicNumber} n_i={NInitial} n_f={NFinal} " +
                      $"anomalyTrial={AnomalyTrialNumber} shift={AnomalyShiftMultiplier}");

            ResetSimulation();
        }

        private void ResetSimulation()
        {
            // Existing reset/emitter-position logic — unchanged shape, but must now read
            // NInitial / NFinal / AnomalyShiftMultiplier instead of the deleted hardcoded fields.
        }

        // Existing FirePhoton / rubric hooks — add `if (!_configured) return;` guards.
    }
}