using UnityEngine;
using UnityEngine.UI;
using TMPro;
using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Collections.Concurrent;

public class AICoachClient : MonoBehaviour
{
    public TMP_InputField chatInput;
    public Button sendButton;
    public TextMeshProUGUI chatHistoryText;

    private ClientWebSocket ws;
    private CancellationTokenSource cts;
    
    // This queue safely passes messages from the network thread to the main thread
    private ConcurrentQueue<string> messageQueue = new ConcurrentQueue<string>();

    async void Start()
    {
        cts = new CancellationTokenSource();
        ws = new ClientWebSocket();
        sendButton.onClick.AddListener(SendMessage);
        
        try
        {
            await ws.ConnectAsync(new Uri("ws://localhost:3003"), cts.Token);
            Debug.Log("Connected to AI Coach");
            ReceiveMessages();
        }
        catch (Exception e)
        {
            Debug.LogError("WebSocket Error: " + e.Message);
        }
    }

    async void SendMessage()
    {
        if (string.IsNullOrEmpty(chatInput.text) || ws.State != WebSocketState.Open) return;

        string message = chatInput.text;
        
        // Add user message to UI immediately
        chatHistoryText.text += $"\n<color=#60a5fa><b>You:</b> {message}</color>";
        chatInput.text = "";

        byte[] bytes = Encoding.UTF8.GetBytes(message);
        await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cts.Token);
    }

    private async void ReceiveMessages()
    {
        byte[] buffer = new byte[1024 * 4];
        while (ws.State == WebSocketState.Open)
        {
            try
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                if (result.MessageType == WebSocketMessageType.Text)
                {
                    string response = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    // Put the message in the queue instead of directly touching the UI
                    messageQueue.Enqueue(response); 
                }
            }
            catch { break; }
        }
    }

    void Update()
    {
        // Check if there are any messages from the AI waiting in the queue
        while (messageQueue.TryDequeue(out string response))
        {
            // This runs on the main thread, so it's safe to update the UI!
            chatHistoryText.text += $"\n<color=#4ade80><b>Coach:</b> {response}</color>";
        }
    }

    void OnDestroy()
    {
        cts?.Cancel();
        ws?.Dispose();
    }
}