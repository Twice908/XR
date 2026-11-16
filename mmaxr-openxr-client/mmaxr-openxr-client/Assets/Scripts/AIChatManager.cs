using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine;
using TMPro;

namespace MMAXR.UI
{
    public class AIChatManager : MonoBehaviour
    {
        [Header("UI References")]
        [SerializeField] private TMP_InputField inputField;
        [SerializeField] private TextMeshProUGUI chatLogDisplay;
        [SerializeField] private GameObject    chatPanel;

        private ClientWebSocket _ws;
        private CancellationTokenSource _cts;
        private const string WsUrl = "ws://localhost:3003";

        private async void Start()
        {
            _cts = new CancellationTokenSource();
            await ConnectWebSocketAsync();
        }

        private async Task ConnectWebSocketAsync()
        {
            _ws = new ClientWebSocket();
            try
            {
                await _ws.ConnectAsync(new Uri(WsUrl), _cts.Token);
                Debug.Log("[AIChat] Connected to AI Coach.");
                _ = ReceiveLoopAsync();
            }
            catch (Exception e)
            {
                Debug.LogError($"[AIChat] Connection failed: {e.Message}");
                AppendToChat("System", "AI Coach is offline. Please check backend.");
            }
        }

        private async Task ReceiveLoopAsync()
        {
            var buffer = new byte[1024 * 4];
            while (_ws.State == WebSocketState.Open)
            {
                try
                {
                    var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), _cts.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", _cts.Token);
                        break;
                    }

                    string jsonResponse = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    ProcessIncomingMessage(jsonResponse);
                }
                catch (Exception e)
                {
                    Debug.LogError($"[AIChat] Receive error: {e.Message}");
                    break;
                }
            }
        }

        private void ProcessIncomingMessage(string json)
        {
            try
            {
                // Assuming backend sends: { "type": "chat", "text": "..." } or { "type": "guardrail", "text": "..." }
                var msg = JsonConvert.DeserializeObject<AIMessageDto>(json);

                if (msg.type == "guardrail_blocked")
                {
                    // GUARDRAIL TRIGGERED
                    Debug.Log("[AIChat] Guardrail triggered!");
                    AppendToChat("AI Coach (Guardrail)", msg.text); // Prints the safe fallback text
                }
                else if (msg.type == "chat")
                {
                    AppendToChat("AI Coach", msg.text);
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[AIChat] Parse error: {e.Message} | Raw: {json}");
            }
        }

        public async void SubmitMessage()
        {
            if (string.IsNullOrWhiteSpace(inputField.text) || _ws.State != WebSocketState.Open) return;

            string userText = inputField.text;
            AppendToChat("You", userText);
            inputField.text = "";

            var payload = new { type = "chat", message = userText };
            string json = JsonConvert.SerializeObject(payload);
            byte[] bytes = Encoding.UTF8.GetBytes(json);

            try
            {
                await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token);
            }
            catch (Exception e)
            {
                Debug.LogError($"[AIChat] Send error: {e.Message}");
            }
        }

        private void AppendToChat(string sender, string text)
        {
            if (chatLogDisplay != null)
                chatLogDisplay.text += $"\n<color={(sender.Contains("Guardrail") ? "red" : "white")}><b>[{sender}]</b></color> {text}";
        }

        private async void OnDestroy()
        {
            if (_ws != null && _ws.State == WebSocketState.Open)
            {
                _cts.Cancel();
                await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "App Quit", CancellationToken.None);
            }
            _cts?.Dispose();
        }

        [Serializable]
        private class AIMessageDto
        {
            public string type;
            public string text;
        }
    }
}