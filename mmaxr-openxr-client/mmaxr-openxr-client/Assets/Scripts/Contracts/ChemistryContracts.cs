using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace MMAXR.Contracts
{
    [Serializable]
    public class ChemistryLessonContract
    {
        [JsonProperty("lessonId")]          public string LessonId;
        [JsonProperty("type")]              public string Type;
        [JsonProperty("title")]             public string Title;
        [JsonProperty("modelUrl")]          public string ModelUrl;
        [JsonProperty("config")]            public ChemistryConfig Config;
        [JsonProperty("indicators")]        public List<Indicator> Indicators;
        [JsonProperty("assignedSolutions")] public List<AssignedSolution> AssignedSolutions;
    }

    [Serializable]
    public class ChemistryConfig
    {
        [JsonProperty("totalTestTubes")]             public int TotalTestTubes;
        [JsonProperty("requiredIndicatorsToSelect")] public int RequiredIndicatorsToSelect;
    }

    [Serializable]
    public class Indicator
    {
        [JsonProperty("id")]     public string Id;
        [JsonProperty("name")]   public string Name;
        [JsonProperty("source")] public string Source;
        // Using a Dictionary to safely catch any color object format the backend sends
        [JsonProperty("colors")] public Dictionary<string, string> Colors; 
    }

    [Serializable]
    public class AssignedSolution
    {
        [JsonProperty("id")]      public string Id;
        [JsonProperty("name")]    public string Name;
        [JsonProperty("formula")] public string Formula;
        [JsonProperty("type")]    public string Type; 
        [JsonProperty("ph")]      public float Ph;
    }
}