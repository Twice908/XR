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