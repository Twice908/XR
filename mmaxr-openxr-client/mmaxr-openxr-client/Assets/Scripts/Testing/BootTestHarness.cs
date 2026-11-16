using System;
using System.Collections;
using System.Text;
using GLTFast;
using MMAXR.Contracts;
using MMAXR.Networking;
using MMAXR.Sensors;
using UnityEngine;
using UnityEngine.Networking;
using Newtonsoft.Json;

namespace MMAXR.Testing
{

    
    /// <summary>
    /// Staged integration tester for the MMAXR boot path.
    /// Right-click the component in the Inspector to run individual stages,
    /// or press Play with "Run On Start" ticked to run everything.
    ///
    /// Assumes LabController.autoBootOnStart = false so it doesn't race.
    /// </summary>
    public class BootTestHarness : MonoBehaviour
    {
        [Header("Dependencies (wire the same instances LabController uses)")]
        [SerializeField] private TelemetryClient telemetry;
        [SerializeField] private SensorLogger    sensorLogger;
        [SerializeField] private Transform       modelRoot;
        [Header("Config — must match backend contract")]
        [SerializeField] private string studentId         = "student_99";
        [SerializeField] private string lessonId          = "physics-101";
        [SerializeField] private string lessonUrl         = "http://localhost:3007/lessons/active";
        [SerializeField] private int    sensorTestSeconds = 3;

        [Header("Offline Mock (leave empty for live network)")]
        [TextArea(3, 10)] [SerializeField] private string mockLessonJson = "";

        [Header("Stages to run in Run All")]
        [SerializeField] private bool runAuth         = true;
        [SerializeField] private bool runLessonParse  = true;
        [SerializeField] private bool runGltf         = true;
        [SerializeField] private bool runSensorUpload = true;

        [Header("Run On Play")]
        [SerializeField] private bool runOnStart = false;

        // Result tracking
        private bool           _authPass, _lessonPass, _gltfPass, _sensorPass, _uploadPass;
        private string         _sessionId;
        private LessonContract _lesson;
        private GltfImport     _gltf;

        private void Start()
        {
            if (runOnStart) RunAll();
        }

        [ContextMenu("Run All Stages")]
        public void RunAll() { StopAllCoroutines(); StartCoroutine(RunAllRoutine()); }

        [ContextMenu("Stage 1 — Auth")]
        public void StageAuth() { StopAllCoroutines(); StartCoroutine(StageAuthRoutine()); }

        [ContextMenu("Stage 2 — Lesson Parse")]
        public void StageLesson() { StopAllCoroutines(); StartCoroutine(StageLessonRoutine()); }

        [ContextMenu("Stage 3 — glTF Load")]
        public void StageGltf() { StopAllCoroutines(); StartCoroutine(StageGltfRoutine()); }

        [ContextMenu("Stages 4+5 — Sensor + Upload")]
        public void StageSensorUpload() { StopAllCoroutines(); StartCoroutine(StageSensorUploadRoutine()); }

        private IEnumerator RunAllRoutine()
        {
            Log("=== TEST RUN START ===");
            if (runAuth)         yield return StageAuthRoutine();
            if (runLessonParse)  yield return StageLessonRoutine();
            if (runGltf)         yield return StageGltfRoutine();
            if (runSensorUpload) yield return StageSensorUploadRoutine();

            Log("=== SUMMARY ===");
            if (runAuth)         Log($"Auth:    {(_authPass   ? "PASS" : "FAIL")}");
            if (runLessonParse)  Log($"Lesson:  {(_lessonPass ? "PASS" : "FAIL")}");
            if (runGltf)         Log($"glTF:    {(_gltfPass   ? "PASS" : "FAIL")}");
            if (runSensorUpload) Log($"Sensor:  {(_sensorPass ? "PASS" : "FAIL")}");
            if (runSensorUpload) Log($"Upload:  {(_uploadPass ? "PASS" : "FAIL")}");
            Log("=== TEST RUN END ===");
        }

        // ---- Stage 1: Auth ----
        private IEnumerator StageAuthRoutine()
        {
            Log("--- Stage 1: Auth (POST /auth/session) ---");
            if (!telemetry) { Fail("telemetry not assigned"); yield break; }

            yield return telemetry.AuthenticateCoroutine(studentId, lessonId);

            if (!telemetry.IsAuthenticated) { Fail("IsAuthenticated == false — check backend log on :3004"); yield break; }
            _sessionId = telemetry.SessionId;
            if (string.IsNullOrEmpty(_sessionId)) { Fail("SessionId empty despite IsAuthenticated == true"); yield break; }

            Pass($"sessionId = {_sessionId}");
            _authPass = true;
        }

        // ---- Stage 2: Lesson Parse ----
        private IEnumerator StageLessonRoutine()
        {
            Log("--- Stage 2: Lesson Parse (GET /lessons/active) ---");

            string json;
            if (!string.IsNullOrEmpty(mockLessonJson))
            {
                json = mockLessonJson;
                Log("using mockLessonJson — network skipped");
            }
            else
            {
                using var req = UnityWebRequest.Get(lessonUrl);
                req.timeout = 10;
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    Fail($"GET {lessonUrl}: {req.responseCode} {req.error}");
                    yield break;
                }
                json = req.downloadHandler.text;
                Log($"raw: {json}");
            }

            LessonContract lesson;
            try { lesson = JsonConvert.DeserializeObject<LessonContract>(json); }
            catch (Exception e) { Fail($"JsonUtility.FromJson threw: {e.Message}"); yield break; }

            if (lesson == null) { Fail("parsed lesson is null"); yield break; }

            // Diagnostic: catch silent field defaults (see §6 — JsonUtility case-sensitivity)
            var diag = new StringBuilder();
            if (string.IsNullOrEmpty(lesson.LessonId)) diag.AppendLine("  LessonId empty");
            if (string.IsNullOrEmpty(lesson.ModelUrl)) diag.AppendLine("  ModelUrl empty");
            if (lesson.Simulation == null)
                diag.AppendLine("  Simulation null");
            else if (lesson.Simulation.NInitial == 0 && lesson.Simulation.NFinal == 0 && lesson.Simulation.AtomicNumber == 0)
                diag.AppendLine("  Simulation.* all zero (suggests mapping failure, not bad data)");

            if (diag.Length > 0)
            {
                Fail($"parse produced empty/default values:\n{diag}\n>>> If the raw JSON above looks correct, this is the JsonUtility case-sensitivity issue. See §6.");
                yield break;
            }

            // Semantic assertions against the architect's example contract
            bool ok = true;
            if (lesson.LessonId != "physics-101")                        { Fail($"LessonId '{lesson.LessonId}' != 'physics-101'"); ok = false; }
            if (lesson.Simulation.AtomicNumber != 1)                     { Fail($"AtomicNumber {lesson.Simulation.AtomicNumber} != 1"); ok = false; }
            if (lesson.Simulation.NInitial != 3)                         { Fail($"NInitial {lesson.Simulation.NInitial} != 3"); ok = false; }
            if (lesson.Simulation.NFinal != 2)                           { Fail($"NFinal {lesson.Simulation.NFinal} != 2"); ok = false; }
            if (lesson.Simulation.AnomalyTrialNumber != 4)               { Fail($"AnomalyTrialNumber {lesson.Simulation.AnomalyTrialNumber} != 4"); ok = false; }
            if (Mathf.Abs(lesson.Simulation.AnomalyShiftMultiplier - 1.15f) > 0.001f)
                                                                        { Fail($"AnomalyShiftMultiplier {lesson.Simulation.AnomalyShiftMultiplier} != 1.15"); ok = false; }
            if (!ok) yield break;

            _lesson = lesson;
            _lessonPass = true;
            Pass($"id={lesson.LessonId}  Z={lesson.Simulation.AtomicNumber}  n_i={lesson.Simulation.NInitial}  n_f={lesson.Simulation.NFinal}  anomalyTrial={lesson.Simulation.AnomalyTrialNumber}  shift={lesson.Simulation.AnomalyShiftMultiplier}");
        }

        // ---- Stage 3: glTF Load ----
        private IEnumerator StageGltfRoutine()
        {
            Log("--- Stage 3: glTF Load (glTFast) ---");
            if (_lesson == null)                { Fail("_lesson null — run Stage 2 first"); yield break; }
            if (string.IsNullOrEmpty(_lesson.ModelUrl)) { Fail("ModelUrl empty in lesson"); yield break; }
            if (!modelRoot)                     { Fail("modelRoot not assigned"); yield break; }

            _gltf = new GltfImport();
            var loadTask = _gltf.Load(_lesson.ModelUrl);
            while (!loadTask.IsCompleted) yield return null;

            if (loadTask.IsFaulted || !loadTask.Result)
            {
                Fail($"glTF load failed: {loadTask.Exception?.Message}");
                _gltf.Dispose(); _gltf = null; yield break;
            }

            var instTask = _gltf.InstantiateMainSceneAsync(modelRoot);
            while (!instTask.IsCompleted) yield return null;

            if (instTask.IsFaulted)
            {
                Fail($"glTF instantiate failed: {instTask.Exception?.Message}");
                _gltf.Dispose(); _gltf = null; yield break;
            }

            if (modelRoot.childCount == 0)
            {
                Fail("modelRoot has no children after InstantiateMainSceneAsync");
                yield break;
            }

            _gltfPass = true;
            Pass($"loaded {_lesson.ModelUrl}  →  {modelRoot.childCount} child(ren) under modelRoot (visible in Scene view)");
        }

        // ---- Stage 4+5: Sensor + Upload ----
        private IEnumerator StageSensorUploadRoutine()
        {
            Log("--- Stages 4+5: Sensor Logging @30Hz + Upload ---");
            if (!sensorLogger) { Fail("sensorLogger not assigned"); yield break; }
            if (string.IsNullOrEmpty(_sessionId)) { Fail("no sessionId — run Stage 1 first"); yield break; }

            sensorLogger.BeginSession();
            Log($"recording for {sensorTestSeconds}s ...");
            yield return new WaitForSeconds(sensorTestSeconds);

            if (!sensorLogger.IsRecording) { Fail("IsRecording == false after BeginSession"); yield break; }

            int minExpected = Mathf.Max(1, sensorTestSeconds * 25); // tolerate a few dropped frames
            if (sensorLogger.SampleCount < minExpected)
            {
                Fail($"only {sensorLogger.SampleCount} samples in {sensorTestSeconds}s (expected ≥{minExpected})");
                yield break;
            }

            float hz = sensorLogger.SampleCount / (float)sensorTestSeconds;
            _sensorPass = true;
            Pass($"{sensorLogger.SampleCount} samples logged  (~{hz:F1} Hz)");

            Log("uploading ...");
            yield return sensorLogger.StopAndUpload(_sessionId);

            if (!sensorLogger.LastUploadSucceeded)
            {
                Fail("upload failed — see [SensorLogger] error log above");
                yield break;
            }

            _uploadPass = true;
            Pass($"uploaded {sensorLogger.LastUploadBytes} bytes to /upload/{_sessionId}");
            Log(">>> now verify file exists in MinIO (see §4d)");
        }

        private void OnDestroy()
        {
            _gltf?.Dispose();
            _gltf = null;
        }

        private void Log(string m)  => Debug.Log($"[TEST] {m}");
        private void Pass(string m) => Debug.Log($"[TEST] PASS  {m}");
        private void Fail(string m) => Debug.LogError($"[TEST] FAIL  {m}");
    }
}