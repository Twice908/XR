using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace MMAXR.Sensors
{
    public class SensorLogger : MonoBehaviour
    {
        [Header("XR References (wire from XR Origin in inspector)")]
        [SerializeField] private Transform head;       // Main Camera / XR Origin camera offset
        [SerializeField] private Transform leftHand;   // Left hand interactor attach
        [SerializeField] private Transform rightHand;  // Right hand interactor attach

        [Header("Config")]
        [SerializeField] private int sampleHz = 30;
        [SerializeField] private string uploadBaseUrl = "http://localhost:3005/upload";
        [SerializeField] private int uploadTimeoutSeconds = 30;

        private readonly StringBuilder _csv = new StringBuilder(8192);
        private Coroutine _loop;
        private bool _recording;

        public bool IsRecording => _recording;
        public int SampleCount { get; private set; }
        public bool LastUploadSucceeded { get; private set; }
        public int LastUploadBytes { get; private set; }

        public void BeginSession()
        {
            if (_recording) return;
            _csv.Clear();
            _csv.Append("timestamp,")
                .Append("headX,headY,headZ,headRX,headRY,headRZ,headRW,")
                .Append("leftX,leftY,leftZ,leftRX,leftRY,leftRZ,leftRW,")
                .Append("rightX,rightY,rightZ,rightRX,rightRY,rightRZ,rightRW\n");
            SampleCount = 0;
            _recording = true;
            _loop = StartCoroutine(SampleLoop());
            Debug.Log($"[SensorLogger] Recording @ {sampleHz}Hz");
        }

        private IEnumerator SampleLoop()
        {
            var interval = new WaitForSeconds(1f / sampleHz);
            while (_recording)
            {
                AppendSample();
                yield return interval;
            }
        }

        private void AppendSample()
        {
            if (head == null) return;

            Vector3 hp = head.position; Quaternion hr = head.rotation;
            Vector3 lp = leftHand ? leftHand.position : Vector3.zero;
            Quaternion lr = leftHand ? leftHand.rotation : Quaternion.identity;
            Vector3 rp = rightHand ? rightHand.position : Vector3.zero;
            Quaternion rr = rightHand ? rightHand.rotation : Quaternion.identity;

            _csv.Append(DateTime.UtcNow.ToString("o")).Append(',')
                .Append(hp.x).Append(',').Append(hp.y).Append(',').Append(hp.z).Append(',')
                .Append(hr.x).Append(',').Append(hr.y).Append(',').Append(hr.z).Append(',').Append(hr.w).Append(',')
                .Append(lp.x).Append(',').Append(lp.y).Append(',').Append(lp.z).Append(',')
                .Append(lr.x).Append(',').Append(lr.y).Append(',').Append(lr.z).Append(',').Append(lr.w).Append(',')
                .Append(rp.x).Append(',').Append(rp.y).Append(',').Append(rp.z).Append(',')
                .Append(rr.x).Append(',').Append(rr.y).Append(',').Append(rr.z).Append(',').Append(rr.w)
                .Append('\n');
            SampleCount++;
        }

        /// <summary>Called from OnSessionEnd. Multipart POSTs the CSV to /upload/:sessionId.</summary>
        public IEnumerator StopAndUpload(string sessionId)
        {
            _recording = false;
            if (_loop != null) { StopCoroutine(_loop); _loop = null; }

            if (string.IsNullOrEmpty(sessionId))
            {
                Debug.LogError("[SensorLogger] Upload skipped — no sessionId.");
                yield break;
            }
            if (_csv.Length == 0)
            {
                Debug.LogWarning("[SensorLogger] Upload skipped — no samples.");
                yield break;
            }

            byte[] csvBytes = Encoding.UTF8.GetBytes(_csv.ToString());
            var form = new WWWForm();
            form.AddBinaryData("file", csvBytes, "sensor_data.csv", "text/csv");

            string url = $"{uploadBaseUrl}/{sessionId}";
            using var req = UnityWebRequest.Post(url, form);
            req.timeout = uploadTimeoutSeconds;

            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                LastUploadSucceeded = false;
                LastUploadBytes = 0;
                Debug.LogError($"[SensorLogger] Upload failed: {req.responseCode} {req.error}\n{req.downloadHandler.text}");
            }
            else
            {
                LastUploadSucceeded = true;
                LastUploadBytes = csvBytes.Length;
                Debug.Log($"[SensorLogger] Uploaded {SampleCount} samples ({csvBytes.Length} bytes) → {url}");
            }
        }
    }
}