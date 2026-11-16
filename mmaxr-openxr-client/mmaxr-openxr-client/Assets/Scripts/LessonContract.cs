using System;
using Newtonsoft.Json;

namespace MMAXR.Contracts
{
    [Serializable]
    public class LessonContract
    {
        [JsonProperty("lessonId")]               public string LessonId;
        [JsonProperty("title")]                  public string Title;
        [JsonProperty("modelUrl")]               public string ModelUrl;
        [JsonProperty("simulation")]             public SimulationContract Simulation;
    }

    [Serializable]
    public class SimulationContract
    {
        [JsonProperty("atomicNumber")]           public int   AtomicNumber;
        [JsonProperty("nInitial")]               public int   NInitial;
        [JsonProperty("nFinal")]                 public int   NFinal;
        [JsonProperty("anomalyTrialNumber")]     public int   AnomalyTrialNumber;
        [JsonProperty("anomalyShiftMultiplier")] public float AnomalyShiftMultiplier;
    }
}