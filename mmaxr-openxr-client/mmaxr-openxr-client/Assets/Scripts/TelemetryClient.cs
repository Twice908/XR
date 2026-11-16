// using UnityEngine;
// using UnityEngine.Networking;
// using System.Collections;

// [System.Serializable]
// public class TelemetryPayload
// {
//     public string sessionId;
//     public string studentId;
//     public long timestamp;
//     public string verb;
//     public ObjectData @object; // Using @ allows us to name it 'object' for the JSON
// }

// [System.Serializable]
// public class ObjectData
// {
//     public string action;
//     public string target;
//     public float value;
//     public float expected;
//     public float actual;
// }

// public class TelemetryClient : MonoBehaviour
// {
//     private string sessionId;
//     private const string studentId = "student_unity_01";
//     private const string backendUrl = "http://localhost:3001/events";

//     void Awake()
//     {
//         sessionId = "sess_unity_" + System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
//     }

//     public void SendEvent(string verb, ObjectData data = null)
//     {
//         TelemetryPayload payload = new TelemetryPayload
//         {
//             sessionId = sessionId,
//             studentId = studentId,
//             timestamp = System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
//             verb = verb,
//             @object = data
//         };

//         string json = JsonUtility.ToJson(payload);
//         StartCoroutine(PostData(json));
//     }

//     IEnumerator PostData(string json)
//     {
//         using (UnityWebRequest request = new UnityWebRequest(backendUrl, "POST"))
//         {
//             byte[] bodyRaw = System.Text.Encoding.UTF8.GetBytes(json);
//             request.uploadHandler = new UploadHandlerRaw(bodyRaw);
//             request.downloadHandler = new DownloadHandlerBuffer();
//             request.SetRequestHeader("Content-Type", "application/json");

//             yield return request.SendWebRequest();

//             if (request.result == UnityWebRequest.Result.Success)
//                 Debug.Log($"[Telemetry] Sent: {json}");
//             else
//                 Debug.LogError($"[Telemetry] Error: {request.error}");
//         }
//     }
// }

using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;
using Newtonsoft.Json;

namespace MMAXR.Networking
{
    public class TelemetryClient : MonoBehaviour
    {
        [SerializeField] private string authUrl = "http://localhost:3004/auth/session";
        [SerializeField] private int authTimeoutSeconds = 10;

        public string SessionId { get; private set; }
        public bool IsAuthenticated => !string.IsNullOrEmpty(SessionId);

        public event Action<string> OnAuthSucceeded;
        public event Action<string> OnAuthFailed;

        public IEnumerator AuthenticateCoroutine(string studentId, string lessonId)
        {
            // Wire format is lowercase (backend contract). Request DTO is private; not the response contract.
            var payload = new AuthRequestDto { studentId = studentId, lessonId = lessonId };
            string body = JsonUtility.ToJson(payload);

            using var req = new UnityWebRequest(authUrl, UnityWebRequest.kHttpVerbPOST);
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.timeout = authTimeoutSeconds;

            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[Telemetry] Auth failed: {req.responseCode} {req.error}\n{req.downloadHandler.text}");
                OnAuthFailed?.Invoke(req.error);
                yield break;
            }

            AuthResponseDto resp;
            try { resp = JsonConvert.DeserializeObject<AuthResponseDto>(req.downloadHandler.text); }
            catch (Exception e)
            {
                Debug.LogError($"[Telemetry] Auth JSON parse error: {e.Message}\n{req.downloadHandler.text}");
                OnAuthFailed?.Invoke("parse_error");
                yield break;
            }

            if (resp == null || string.IsNullOrEmpty(resp.SessionId))
            {
                Debug.LogError($"[Telemetry] Auth response missing sessionId: {req.downloadHandler.text}");
                OnAuthFailed?.Invoke("missing_sessionId");
                yield break;
            }

            SessionId = resp.SessionId; // No DateTimeOffset anywhere.
            Debug.Log($"[Telemetry] Authenticated. sessionId={SessionId}");
            OnAuthSucceeded?.Invoke(SessionId);
        }

        /// <summary>
        /// Guarded send. Returns false if dropped due to missing session.
        /// </summary>
        public bool SendEvent(string eventType, string jsonPayload)
        {
            if (!IsAuthenticated)
            {
                Debug.LogWarning($"[Telemetry] Dropped '{eventType}' — no sessionId (not authenticated).");
                return false;
            }
            return SendEventInternal(eventType, jsonPayload);
        }

        private bool SendEventInternal(string eventType, string jsonPayload)
        {
            // Existing emission pipeline goes here — untouched. Must include SessionId in envelope.
            return true;
        }

                [Serializable] private class AuthRequestDto  
        { 
            [JsonProperty("studentId")] public string studentId; 
            [JsonProperty("lessonId")]  public string lessonId; 
        }
        
        [Serializable] private class AuthResponseDto 
        { 
            [JsonProperty("sessionId")] public string SessionId; 
        }

        /// <summary>Test-harness helper — clears session so auth can be re-run.</summary>
        public void ResetSession()
        {
            SessionId = null;
            Debug.Log("[Telemetry] Session reset for retesting.");
        }
                [Serializable]
        private class TelemetryBatchPayload
        {
            public TelemetryEvent[] events;
        }

        [Serializable]
        public class TelemetryEvent
        {
            public string sessionId;
            public string eventType;
            public string timestamp;
            public string payload; // JSON string of the specific event data
        }

        /// <summary>
        /// Sends events to http://localhost:3001/events in the exact format the backend expects.
        /// </summary>
        public IEnumerator SendBatchCoroutine(TelemetryEvent[] eventsToSend)
        {
            if (!IsAuthenticated) yield break;
            
            // Ensure the sessionId is injected into every event
            foreach (var e in eventsToSend) { e.sessionId = SessionId; }

            var payload = new TelemetryBatchPayload { events = eventsToSend };
            string body = JsonConvert.SerializeObject(payload);
            string telemetryUrl = "http://localhost:3001/events";

            using var req = new UnityWebRequest(telemetryUrl, UnityWebRequest.kHttpVerbPOST);
            req.uploadHandler   = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");

            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
                Debug.LogError($"[Telemetry] Batch send failed: {req.responseCode} {req.error}\n{req.downloadHandler.text}");
            else
                Debug.Log($"[Telemetry] Sent batch of {eventsToSend.Length} events.");
        }
    }
}