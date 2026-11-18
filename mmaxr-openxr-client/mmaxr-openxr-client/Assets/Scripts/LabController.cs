using System;
using System.Collections;
using GLTFast;
using MMAXR.Contracts;
using MMAXR.Networking;
using MMAXR.Sensors;
using MMAXR.Simulation;
using MMAXR.UI;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Networking;

namespace MMAXR.Core
{
    public class LabController : MonoBehaviour
    {
        [Header("Dependencies (Leave empty - Auto-finds on Play)")]
        [SerializeField] private TelemetryClient    telemetry;
        [SerializeField] private SpectralSimulation simulation;
        [SerializeField] private SensorLogger       sensorLogger;
        [SerializeField] private Transform          modelRoot;

        [Header("Chemistry UI (Leave empty - Auto-finds on Play)")]
        [SerializeField] private ChemistryTableUI   chemistryUI;
        [SerializeField] private Transform          uiCanvasRoot;

        [Header("Config")]
        [SerializeField] private string studentId       = "student_99";
        [SerializeField] private string lessonId        = "chemistry-101";
        [SerializeField] private string activeLessonUrl = "http://localhost:3007/lessons/active?type=chemistry";
        [SerializeField] private int    lessonTimeoutSeconds = 15;
        
        [Header("Boot Control")]
        [SerializeField] private bool autoBootOnStart = true;

        private GltfImport  _gltf;
        private GameObject  _loadedModel;
        private bool        _sessionEnded;

        private void Awake()
        {
            // --- AUTOMATIC ASSIGNMENT MAGIC ---
            if (telemetry == null)    telemetry = FindAnyObjectByType<TelemetryClient>();
            if (simulation == null)   simulation = FindAnyObjectByType<SpectralSimulation>();
            if (sensorLogger == null) sensorLogger = FindAnyObjectByType<SensorLogger>();
            if (chemistryUI == null)  chemistryUI = FindAnyObjectByType<ChemistryTableUI>();

            // Auto-find the Canvas for the UI
            if (uiCanvasRoot == null)
            {
                Canvas canvas = FindAnyObjectByType<Canvas>();
                if (canvas != null) uiCanvasRoot = canvas.transform;
            }

            // Auto-find the Model Root if not assigned (looks for a child named "ModelRoot")
            if (modelRoot == null)
            {
                Transform existing = transform.Find("ModelRoot");
                if (existing != null) modelRoot = existing;
                else
                {
                    GameObject rootObj = new GameObject("Auto_ModelRoot");
                    rootObj.transform.SetParent(this.transform, false);
                    modelRoot = rootObj.transform;
                }
            }
        }

        private IEnumerator Start()
        {
            if (!autoBootOnStart)
            {
                Debug.LogWarning("[Lab] Auto Boot is turned OFF. Halted.");
                yield break;
            }

            Debug.Log("[Lab] Booting up...");

            if (telemetry == null)
            {
                Debug.LogError("[Lab] CRITICAL: Could not find TelemetryClient in scene!");
                yield break;
            }

            // 1. Session Auth
            yield return telemetry.AuthenticateCoroutine(studentId, lessonId);
            if (!telemetry.IsAuthenticated)
            {
                Debug.LogError("[Lab] Halted: Auth failed.");
                yield break;
            }

            // 2. Fetch Lesson & Load Model
            yield return LoadActiveLessonCoroutine();

            // 3. Start Sensor Logger
            if (sensorLogger != null) sensorLogger.BeginSession();
        }

        private IEnumerator LoadActiveLessonCoroutine()
        {
            Debug.Log($"[Lab] Fetching: {activeLessonUrl}");
            using var req = UnityWebRequest.Get(activeLessonUrl);
            req.timeout = lessonTimeoutSeconds;
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[Lab] Lesson fetch failed: {req.responseCode} {req.error}");
                yield break;
            }

            string json = req.downloadHandler.text;
            Debug.Log($"[Lab] Raw Lesson JSON: {json}");

            ChemistryLessonContract chemLesson = null;
            LessonContract physLesson = null;

            try
            {
                var baseObj = Newtonsoft.Json.Linq.JObject.Parse(json);
                string lessonType = baseObj["type"]?.ToString();

                if (lessonType == "chemistry_indicators")
                {
                    chemLesson = JsonConvert.DeserializeObject<ChemistryLessonContract>(json);
                }
                else
                {
                    physLesson = JsonConvert.DeserializeObject<LessonContract>(json);
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[Lab] Lesson parse error: {e.Message}");
                yield break;
            }

            if (chemLesson != null)
            {
                Debug.Log($"[Lab] Loaded Chemistry Lesson: {chemLesson.Title}");
                yield return Load3DModel(chemLesson.ModelUrl);

                if (chemistryUI != null && uiCanvasRoot != null)
                {
                    chemistryUI.RenderTable(chemLesson, uiCanvasRoot);
                    Debug.Log("[Lab] Chemistry Table UI Rendered.");
                }
                else
                {
                    Debug.LogWarning("[Lab] Chemistry UI script or Canvas missing!");
                }
            }
            else if (physLesson != null)
            {
                Debug.Log($"[Lab] Loaded Physics Lesson: {physLesson.Title}");
                yield return Load3DModel(physLesson.ModelUrl);
                if (simulation != null) simulation.Configure(physLesson.Simulation, _loadedModel);
            }
        }

        private IEnumerator Load3DModel(string modelUrl)
        {
            if (string.IsNullOrEmpty(modelUrl)) yield break;

            if (_gltf != null) { _gltf.Dispose(); _gltf = null; }
            
            _gltf = new GltfImport();
            var loadTask = _gltf.Load(modelUrl);
            while (!loadTask.IsCompleted) yield return null;

            if (loadTask.IsFaulted || !loadTask.Result)
            {
                Debug.LogError($"[Lab] glTF load failed: {modelUrl}");
                _gltf.Dispose(); _gltf = null;
                yield break;
            }

            var instTask = _gltf.InstantiateMainSceneAsync(modelRoot);
            while (!instTask.IsCompleted) yield return null;

            if (instTask.IsFaulted)
            {
                Debug.LogError($"[Lab] glTF instantiate failed.");
                _gltf.Dispose(); _gltf = null;
                yield break;
            }

            _loadedModel = modelRoot.childCount > 0
                ? modelRoot.GetChild(modelRoot.childCount - 1).gameObject
                : null;

            if (_loadedModel != null && _loadedModel.GetComponentInChildren<Collider>() == null)
            {
                var box = _loadedModel.AddComponent<BoxCollider>();
                Renderer[] renderers = _loadedModel.GetComponentsInChildren<Renderer>();
                if (renderers.Length > 0)
                {
                    Bounds bounds = renderers[0].bounds;
                    foreach (Renderer r in renderers) bounds.Encapsulate(r.bounds);
                    box.center = _loadedModel.transform.InverseTransformPoint(bounds.center);
                    box.size = bounds.size;
                }
            }
        }

        public void EndSession()
        {
            if (_sessionEnded) return;
            _sessionEnded = true;
            StartCoroutine(EndSessionCoroutine());
        }

        private IEnumerator EndSessionCoroutine()
        {
            if (sensorLogger != null && telemetry.IsAuthenticated)
                yield return sensorLogger.StopAndUpload(telemetry.SessionId);
            Debug.Log("[Lab] Session ended.");
        }

        private void OnApplicationQuit() { EndSession(); }
        
        private void OnDestroy()
        {
            EndSession();
            if (_loadedModel != null) Destroy(_loadedModel);
            _gltf?.Dispose();
            _gltf = null;
        }
    }
}