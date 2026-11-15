using UnityEngine;

public class LabController : MonoBehaviour
{
    public Camera mainCamera;
    public GameObject predictionMarker;
    public LineRenderer resultLine;

    private SpectralSimulation simulation;
    private TelemetryClient telemetry;
    
    private string currentState = "IDLE";
    private float predictedWavelength = 0f;
    private int targetNInitial = 3;
    private int targetNFinal = 2;

    void Start()
    {
        simulation = GetComponent<SpectralSimulation>();
        telemetry = GetComponent<TelemetryClient>();
        predictionMarker.SetActive(false);
        resultLine.gameObject.SetActive(false);
    }

    void Update()
    {
        if (UnityEngine.InputSystem.Mouse.current != null && UnityEngine.InputSystem.Mouse.current.leftButton.wasPressedThisFrame)
        {
            Vector2 mousePosition = UnityEngine.InputSystem.Mouse.current.position.ReadValue();
            Ray ray = mainCamera.ScreenPointToRay(mousePosition);
            RaycastHit hit;

            if (Physics.Raycast(ray, out hit))
            {
                if (hit.collider.CompareTag("Spectrometer"))
                {
                    HandleInteraction(hit.point);
                }
            }
        }
    }

    void HandleInteraction(Vector3 hitPoint)
    {
        if (currentState == "IDLE")
        {
            // 1. Prediction
            predictionMarker.transform.position = hitPoint;
            predictionMarker.SetActive(true);
            predictedWavelength = simulation.PredictWavelength(targetNInitial, targetNFinal);
            
            telemetry.SendEvent("predicted", new ObjectData { target = "spectrometer", value = predictedWavelength });
            currentState = "PREDICTED";
            Debug.Log("State: PREDICTED");
        }
        else if (currentState == "PREDICTED")
        {
            // 2. Action
            telemetry.SendEvent("acted", new ObjectData { action = "fire_photon" });
            var result = simulation.FirePhoton(targetNInitial, targetNFinal);
            
            // 3. Observation
            resultLine.gameObject.SetActive(true);
            resultLine.SetPosition(0, new Vector3(hitPoint.x, hitPoint.y - 0.4f, hitPoint.z));
            resultLine.SetPosition(1, new Vector3(hitPoint.x, hitPoint.y + 0.4f, hitPoint.z));
            
            resultLine.startColor = result.isAnomaly ? Color.red : Color.green;
            resultLine.endColor = result.isAnomaly ? Color.red : Color.green;

            telemetry.SendEvent("observed", new ObjectData { value = result.measuredWavelength });

            if (result.isAnomaly)
            {
                telemetry.SendEvent("noticed_anomaly", new ObjectData { expected = predictedWavelength, actual = result.measuredWavelength });
                Debug.Log($"ANOMALY DETECTED! Predicted: {predictedWavelength}, Actual: {result.measuredWavelength}");
            }

            currentState = "IDLE";
            Debug.Log("State: IDLE");
        }
    }
}