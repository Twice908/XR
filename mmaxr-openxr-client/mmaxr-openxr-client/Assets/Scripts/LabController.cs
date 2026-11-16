// using UnityEngine;

// public class LabController : MonoBehaviour
// {
//     public Camera mainCamera;
//     public GameObject predictionMarker;
//     public LineRenderer resultLine;

//     private SpectralSimulation simulation;
//     private TelemetryClient telemetry;

//     private string currentState = "IDLE";
//     private float predictedWavelength = 0f;
//     private int targetNInitial = 3;
//     private int targetNFinal = 2;

//     void Start()
//     {
//         simulation = GetComponent<SpectralSimulation>();
//         telemetry = GetComponent<TelemetryClient>();
//         predictionMarker.SetActive(false);
//         resultLine.gameObject.SetActive(false);
//     }

//     void Update()
//     {
//         if (UnityEngine.InputSystem.Mouse.current != null && UnityEngine.InputSystem.Mouse.current.leftButton.wasPressedThisFrame)
//         {
//             Vector2 mousePosition = UnityEngine.InputSystem.Mouse.current.position.ReadValue();
//             Ray ray = mainCamera.ScreenPointToRay(mousePosition);
//             RaycastHit hit;

//             if (Physics.Raycast(ray, out hit))
//             {
//                 if (hit.collider.CompareTag("Spectrometer"))
//                 {
//                     HandleInteraction(hit.point);
//                 }
//             }
//         }
//     }

//     void HandleInteraction(Vector3 hitPoint)
//     {
//         if (currentState == "IDLE")
//         {
//             // 1. Prediction
//             predictionMarker.transform.position = hitPoint;
//             predictionMarker.SetActive(true);
//             predictedWavelength = simulation.PredictWavelength(targetNInitial, targetNFinal);

//             telemetry.SendEvent("predicted", new ObjectData { target = "spectrometer", value = predictedWavelength });
//             currentState = "PREDICTED";
//             Debug.Log("State: PREDICTED");
//         }
//         else if (currentState == "PREDICTED")
//         {
//             // 2. Action
//             telemetry.SendEvent("acted", new ObjectData { action = "fire_photon" });
//             var result = simulation.FirePhoton(targetNInitial, targetNFinal);

//             // 3. Observation
//             resultLine.gameObject.SetActive(true);
//             resultLine.SetPosition(0, new Vector3(hitPoint.x, hitPoint.y - 0.4f, hitPoint.z));
//             resultLine.SetPosition(1, new Vector3(hitPoint.x, hitPoint.y + 0.4f, hitPoint.z));

//             resultLine.startColor = result.isAnomaly ? Color.red : Color.green;
//             resultLine.endColor = result.isAnomaly ? Color.red : Color.green;

//             telemetry.SendEvent("observed", new ObjectData { value = result.measuredWavelength });

//             if (result.isAnomaly)
//             {
//                 telemetry.SendEvent("noticed_anomaly", new ObjectData { expected = predictedWavelength, actual = result.measuredWavelength });
//                 Debug.Log($"ANOMALY DETECTED! Predicted: {predictedWavelength}, Actual: {result.measuredWavelength}");
//             }

//             currentState = "IDLE";
//             Debug.Log("State: IDLE");
//         }
//     }
// }

using System.Collections;
using GLTFast;
using MMAXR.Contracts;
using MMAXR.Networking;
using MMAXR.Sensors;
using MMAXR.Simulation;
using UnityEngine;
using UnityEngine.Networking;
using Newtonsoft.Json;

namespace MMAXR.Core
{
    public class LabController : MonoBehaviour
    {
        [Header("Dependencies")]
        [SerializeField] private TelemetryClient telemetry;
        [SerializeField] private SpectralSimulation simulation;
        [SerializeField] private SensorLogger sensorLogger;
        [SerializeField] private Transform modelRoot;

        [Header("Config")]
        [SerializeField] private string studentId = "student_99";
        [SerializeField] private string lessonId = "physics-101";
        [SerializeField] private string activeLessonUrl = "http://localhost:3007/lessons/active";

        [Header("Boot Control")]
        [SerializeField] private bool autoBootOnStart = true;
        [SerializeField] private int lessonTimeoutSeconds = 15;

        private GltfImport _gltf;
        private GameObject _loadedSpectrometer;
        private bool _sessionEnded;

        private IEnumerator Start()
        {

            if (!autoBootOnStart) yield break;
            // --- Task 1: Session Auth ---
            yield return telemetry.AuthenticateCoroutine(studentId, lessonId);
            if (!telemetry.IsAuthenticated)
            {
                Debug.LogError("[Lab] Halted: auth failed, no sessionId.");
                yield break;
            }

            // --- Tasks 2 & 3: Fetch lesson + glTF + configure simulation ---
            yield return LoadActiveLessonCoroutine();

            // --- Task 4: Start 30Hz sensor logging ---
            if (sensorLogger != null) sensorLogger.BeginSession();
        }

        private IEnumerator LoadActiveLessonCoroutine()
        {
            using var req = UnityWebRequest.Get(activeLessonUrl);
            req.timeout = lessonTimeoutSeconds;
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[Lab] /lessons/active failed: {req.responseCode} {req.error}");
                yield break;
            }

            LessonContract lesson;
            try { lesson = JsonConvert.DeserializeObject<LessonContract>(req.downloadHandler.text); }
            catch (System.Exception e)
            {
                Debug.LogError($"[Lab] Lesson JSON parse error: {e.Message}\n{req.downloadHandler.text}");
                yield break;
            }

            if (lesson == null || string.IsNullOrEmpty(lesson.ModelUrl) || lesson.Simulation == null)
            {
                Debug.LogError("[Lab] Lesson payload missing ModelUrl or Simulation block.");
                yield break;
            }

            // --- Task 2: glTFast dynamic load (identical .glb as WebXR client) ---
            _gltf = new GltfImport();
            var loadTask = _gltf.Load(lesson.ModelUrl);
            while (!loadTask.IsCompleted) yield return null;

            if (loadTask.IsFaulted || !loadTask.Result)
            {
                Debug.LogError($"[Lab] glTF load failed: {lesson.ModelUrl} — {loadTask.Exception?.Message}");
                _gltf.Dispose(); _gltf = null;
                yield break;
            }

            var instantiateTask = _gltf.InstantiateMainSceneAsync(modelRoot);
            while (!instantiateTask.IsCompleted) yield return null;

            if (instantiateTask.IsFaulted)
            {
                Debug.LogError($"[Lab] glTF instantiate failed: {instantiateTask.Exception?.Message}");
                _gltf.Dispose(); _gltf = null;
                yield break;
            }

            _loadedSpectrometer = modelRoot.childCount > 0
                ? modelRoot.GetChild(modelRoot.childCount - 1).gameObject
                : null;

            _loadedSpectrometer = modelRoot.childCount > 0
    ? modelRoot.GetChild(modelRoot.childCount - 1).gameObject
    : null;

            // --- DYNAMIC COLLIDER FIX ---
            if (_loadedSpectrometer != null)
            {
                if (_loadedSpectrometer.GetComponentInChildren<Collider>() == null)
                {
                    var box = _loadedSpectrometer.AddComponent<BoxCollider>();

                    // Calculate the bounds of the loaded model to size the collider correctly
                    Renderer[] renderers = _loadedSpectrometer.GetComponentsInChildren<Renderer>();
                    if (renderers.Length > 0)
                    {
                        Bounds bounds = renderers[0].bounds;
                        foreach (Renderer r in renderers) bounds.Encapsulate(r.bounds);
                        box.center = _loadedSpectrometer.transform.InverseTransformPoint(bounds.center);
                        box.size = bounds.size;
                    }
                    Debug.Log("[Lab] Dynamically added BoxCollider to glTF model for raycasting.");
                }
            }
            // ----------------------------

            simulation.Configure(lesson.Simulation, _loadedSpectrometer);

            // --- Task 3: hand contract to simulation ---
            simulation.Configure(lesson.Simulation, _loadedSpectrometer);

            Debug.Log($"[Lab] Boot OK. session={telemetry.SessionId} " +
                      $"lesson={lesson.LessonId} ({lesson.Title})");
        }

        /// <summary>Hook from end-of-lesson UI / quiz completion.</summary>
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

        private void OnApplicationQuit()
        {
            EndSession();
        }

        private void OnDestroy()
        {
            EndSession();
            if (_loadedSpectrometer != null) Destroy(_loadedSpectrometer);
            _gltf?.Dispose();
            _gltf = null;
        }
    }
}