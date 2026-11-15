using UnityEngine;
using UnityEngine.Networking;
using System.Collections;

[System.Serializable]
public class TelemetryPayload
{
    public string sessionId;
    public string studentId;
    public long timestamp;
    public string verb;
    public ObjectData @object; // Using @ allows us to name it 'object' for the JSON
}

[System.Serializable]
public class ObjectData
{
    public string action;
    public string target;
    public float value;
    public float expected;
    public float actual;
}

public class TelemetryClient : MonoBehaviour
{
    private string sessionId;
    private const string studentId = "student_unity_01";
    private const string backendUrl = "http://localhost:3001/events";

    void Awake()
    {
        sessionId = "sess_unity_" + System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    public void SendEvent(string verb, ObjectData data = null)
    {
        TelemetryPayload payload = new TelemetryPayload
        {
            sessionId = sessionId,
            studentId = studentId,
            timestamp = System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            verb = verb,
            @object = data
        };

        string json = JsonUtility.ToJson(payload);
        StartCoroutine(PostData(json));
    }

    IEnumerator PostData(string json)
    {
        using (UnityWebRequest request = new UnityWebRequest(backendUrl, "POST"))
        {
            byte[] bodyRaw = System.Text.Encoding.UTF8.GetBytes(json);
            request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
                Debug.Log($"[Telemetry] Sent: {json}");
            else
                Debug.LogError($"[Telemetry] Error: {request.error}");
        }
    }
}