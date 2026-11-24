using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using MMAXR.Contracts;

namespace MMAXR.UI
{
    /// <summary>
    /// Spatial data-table HUD for the chemistry lab (IWSDK-style spatial panel:
    /// World Space canvas, rounded 9-sliced panels, generous hit targets, TextMeshPro text).
    ///
    /// Logic layer API (wire from LabController / TelemetryClient):
    ///   PopulateTable(solutions)                      build rows; solution names stay hidden
    ///   UpdateTubeResult(tube, indicator, color)      write an observed color (0-based indices)
    ///   RevealDisclosure()                            show names / formulas / pH / correctness
    /// Events: OnConclusionChanged, OnSubmitRequested, OnDisclosureRevealed.
    ///
    /// XR note: the Canvas needs a TrackedDeviceGraphicRaycaster (XR Interaction Toolkit)
    /// and the scene an XR UI Input Module so rays can press the buttons.
    /// </summary>
    public class ChemistryTableUI : MonoBehaviour
    {
        // ---- Design tokens (spatial dark-glass) ----
        [Header("Theme")]
        [SerializeField] private Color panelColor   = new Color(0.04f, 0.06f, 0.13f, 0.90f);
        [SerializeField] private Color headerColor  = new Color(0.08f, 0.11f, 0.22f, 0.95f);
        [SerializeField] private Color rowColor     = new Color(0.10f, 0.14f, 0.26f, 0.85f);
        [SerializeField] private Color accentColor  = new Color(0.13f, 0.83f, 0.93f, 1f);   // cyan
        [SerializeField] private Color accent2Color = new Color(0.65f, 0.55f, 0.98f, 1f);   // violet
        [SerializeField] private Color textColor    = new Color(0.95f, 0.97f, 1f, 1f);
        [SerializeField] private Color mutedColor   = new Color(0.58f, 0.64f, 0.78f, 1f);
        [SerializeField] private Color goodColor    = new Color(0.64f, 0.90f, 0.21f, 1f);
        [SerializeField] private Color badColor     = new Color(0.98f, 0.44f, 0.52f, 1f);

        [Header("Layout")]
        [SerializeField] private int   indicatorColumns = 3;
        [SerializeField] private Vector2 canvasSize     = new Vector2(1100f, 700f);
        [Tooltip("World units per canvas pixel. 0.001 => 1100px canvas = 1.1m wide.")]
        [SerializeField] private float worldScale       = 0.001f;
        [SerializeField] private bool  forceWorldSpace  = true;

        public event Action<int, string> OnConclusionChanged;   // tubeIndex, "Acid"/"Base"/"Neutral"
        public event Action OnSubmitRequested;
        public event Action OnDisclosureRevealed;

        private static readonly string[] ConclusionOptions = { "—", "Acid", "Base", "Neutral" };
        private static Sprite _rounded;

        private class Cell { public Image Dot; public TMP_Text Label; }
        private class Row  { public Cell Initial; public Cell[] Indicators; public TMP_Text Conclusion; public TMP_Text Ph; public Button ConclusionButton; }

        private RectTransform _root;       // panel root (child of the canvas)
        private RectTransform _rowsHost;
        private GameObject    _disclosure;
        private Button        _submitButton;
        private TMP_Text      _submitLabel;
        private TMP_Text      _title;
        private readonly List<Row> _rows = new List<Row>();
        private List<AssignedSolution> _solutions = new List<AssignedSolution>();
        private int[]    _conclusionIndex = new int[0];
        private bool     _revealed;

        // =====================================================================
        // Public API
        // =====================================================================

        /// <summary>Compatibility entry point used by LabController today.</summary>
        public void RenderTable(ChemistryLessonContract lesson, Transform canvasRoot)
        {
            if (lesson == null) return;
            if (lesson.Config != null && lesson.Config.RequiredIndicatorsToSelect > 0)
                indicatorColumns = lesson.Config.RequiredIndicatorsToSelect;
            EnsureBuilt(canvasRoot);
            if (_title != null) _title.text = string.IsNullOrEmpty(lesson.Title) ? "Chemistry Lab" : lesson.Title;
            PopulateTable(lesson.AssignedSolutions);
        }

        /// <summary>Builds one row per solution. Names/formulas/pH are NOT shown until RevealDisclosure().</summary>
        public void PopulateTable(List<AssignedSolution> solutions)
        {
            EnsureBuilt(transform);
            _solutions = solutions ?? new List<AssignedSolution>();
            _conclusionIndex = new int[_solutions.Count];
            _revealed = false;
            if (_disclosure != null) _disclosure.SetActive(false);
            SetSubmitLabel("Submit Analysis");

            foreach (Transform child in _rowsHost) Destroy(child.gameObject);
            _rows.Clear();

            for (int i = 0; i < _solutions.Count; i++) _rows.Add(BuildRow(i));
        }

        /// <summary>Writes an observed indicator color into the table. Indices are 0-based.</summary>
        public void UpdateTubeResult(int tubeIndex, int indicatorIndex, string observedColor)
        {
            if (tubeIndex < 0 || tubeIndex >= _rows.Count) return;
            Row row = _rows[tubeIndex];
            if (indicatorIndex < 0 || indicatorIndex >= row.Indicators.Length) return;
            SetCell(row.Indicators[indicatorIndex], observedColor);
        }

        /// <summary>Optional: sets the "Initial Color" column (e.g. "Clear") for a tube.</summary>
        public void SetInitialColor(int tubeIndex, string colorName)
        {
            if (tubeIndex < 0 || tubeIndex >= _rows.Count) return;
            SetCell(_rows[tubeIndex].Initial, colorName);
        }

        /// <summary>Final phase: fills pH, locks conclusions and opens the Disclosure panel.</summary>
        public void RevealDisclosure()
        {
            if (_solutions.Count == 0) return;
            _revealed = true;

            for (int i = 0; i < _rows.Count; i++)
            {
                _rows[i].Ph.text = _solutions[i].Ph.ToString("0.#");
                _rows[i].Ph.color = accentColor;
                _rows[i].ConclusionButton.interactable = false;
            }
            SetSubmitLabel("View Disclosure");
            BuildDisclosure();
            _disclosure.SetActive(true);
            OnDisclosureRevealed?.Invoke();
        }

        // =====================================================================
        // Construction
        // =====================================================================

        private void EnsureBuilt(Transform canvasRoot)
        {
            if (_root != null) return;

            Canvas canvas = canvasRoot != null ? canvasRoot.GetComponentInParent<Canvas>() : GetComponentInParent<Canvas>();
            if (canvas == null)
            {
                var go = new GameObject("ChemistryTableCanvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
                go.transform.SetParent(transform, false);
                canvas = go.GetComponent<Canvas>();
                canvas.renderMode = RenderMode.WorldSpace;
                var rt = go.GetComponent<RectTransform>();
                rt.sizeDelta = canvasSize;
                rt.localScale = Vector3.one * worldScale;
            }
            else if (forceWorldSpace && canvas.renderMode != RenderMode.WorldSpace)
            {
                canvas.renderMode = RenderMode.WorldSpace;
                var rt = canvas.GetComponent<RectTransform>();
                rt.sizeDelta = canvasSize;
                rt.localScale = Vector3.one * worldScale;
                if (canvas.worldCamera == null) canvas.worldCamera = Camera.main;
            }

            Transform parent = canvas.transform;
            foreach (Transform child in parent) Destroy(child.gameObject);

            // Panel
            _root = NewRect("ChemistryTablePanel", parent);
            Stretch(_root, 0, 0, 0, 0);
            Rounded(_root.gameObject, panelColor, 28);
            var v = _root.gameObject.AddComponent<VerticalLayoutGroup>();
            v.padding = new RectOffset(28, 28, 22, 22);
            v.spacing = 10;
            v.childControlWidth = v.childControlHeight = true;
            v.childForceExpandWidth = true; v.childForceExpandHeight = false;

            // Title block
            var eyebrow = Text(_root, "HOLOGRAPHIC DATA TABLE", 15, accentColor, FontStyles.Bold, TextAlignmentOptions.Left);
            eyebrow.characterSpacing = 6;
            Fixed(eyebrow.rectTransform, -1, 22);
            _title = Text(_root, "Chemistry Lab", 30, textColor, FontStyles.Bold, TextAlignmentOptions.Left);
            Fixed(_title.rectTransform, -1, 40);

            // Header row
            var header = NewRow(_root, 52, headerColor);
            AddHeader(header, "Test Tube", ColW(0));
            AddHeader(header, "Initial Color", ColW(1));
            for (int i = 0; i < indicatorColumns; i++) AddHeader(header, $"Indicator {i + 1}", ColW(2));
            AddHeader(header, "Conclusion", ColW(3));
            AddHeader(header, "pH Value", ColW(4));

            // Rows host
            _rowsHost = NewRect("Rows", _root);
            var rv = _rowsHost.gameObject.AddComponent<VerticalLayoutGroup>();
            rv.spacing = 8;
            rv.childControlWidth = rv.childControlHeight = true;
            rv.childForceExpandWidth = true; rv.childForceExpandHeight = false;
            var rle = _rowsHost.gameObject.AddComponent<LayoutElement>();
            rle.flexibleHeight = 1;

            // Footer
            _submitButton = MakeButton(_root, "Submit Analysis", accentColor, out _submitLabel, 64);
            _submitButton.onClick.AddListener(() =>
            {
                if (_revealed) { if (_disclosure != null) _disclosure.SetActive(true); return; }
                OnSubmitRequested?.Invoke();
                RevealDisclosure();
            });
        }

        private Row BuildRow(int index)
        {
            var rowRt = NewRow(_rowsHost, 64, rowColor);
            var row = new Row { Indicators = new Cell[indicatorColumns] };

            var tubeLabel = Text(rowRt, $"Tube {index + 1}", 22, textColor, FontStyles.Bold, TextAlignmentOptions.Left);
            Fixed(tubeLabel.rectTransform, ColW(0), -1);

            row.Initial = ColorCell(rowRt, ColW(1));
            SetCell(row.Initial, "Clear");

            for (int i = 0; i < indicatorColumns; i++)
            {
                row.Indicators[i] = ColorCell(rowRt, ColW(2));
                SetCell(row.Indicators[i], null);
            }

            // Conclusion: cycle button (big hit target for ray / poke input)
            row.ConclusionButton = MakeButton(rowRt, "—", accent2Color, out row.Conclusion, -1, 20);
            Fixed((RectTransform)row.ConclusionButton.transform, ColW(3), -1);
            int captured = index;
            row.ConclusionButton.onClick.AddListener(() => CycleConclusion(captured));

            row.Ph = Text(rowRt, "—", 22, mutedColor, FontStyles.Bold, TextAlignmentOptions.Center);
            Fixed(row.Ph.rectTransform, ColW(4), -1);
            return row;
        }

        private void CycleConclusion(int tubeIndex)
        {
            if (_revealed || tubeIndex < 0 || tubeIndex >= _rows.Count) return;
            _conclusionIndex[tubeIndex] = (_conclusionIndex[tubeIndex] + 1) % ConclusionOptions.Length;
            string value = ConclusionOptions[_conclusionIndex[tubeIndex]];
            _rows[tubeIndex].Conclusion.text = value;
            if (_conclusionIndex[tubeIndex] != 0) OnConclusionChanged?.Invoke(tubeIndex, value);
        }

        private void BuildDisclosure()
        {
            if (_disclosure != null) Destroy(_disclosure);

            _disclosure = NewRect("Disclosure", _root).gameObject;
            var scrim = (RectTransform)_disclosure.transform;
            Stretch(scrim, 0, 0, 0, 0);
            _disclosure.AddComponent<LayoutElement>().ignoreLayout = true;
            Rounded(_disclosure, new Color(0.01f, 0.02f, 0.06f, 0.92f), 28);

            var card = NewRect("Card", scrim);
            Stretch(card, 40, 40, 40, 40);
            Rounded(card.gameObject, headerColor, 24);
            var v = card.gameObject.AddComponent<VerticalLayoutGroup>();
            v.padding = new RectOffset(24, 24, 20, 20);
            v.spacing = 8;
            v.childControlWidth = v.childControlHeight = true;
            v.childForceExpandWidth = true; v.childForceExpandHeight = false;

            int correct = 0;
            for (int i = 0; i < _solutions.Count; i++)
                if (IsCorrect(i)) correct++;

            var eyebrow = Text(card, "DISCLOSURE", 15, accentColor, FontStyles.Bold, TextAlignmentOptions.Left);
            eyebrow.characterSpacing = 6; Fixed(eyebrow.rectTransform, -1, 22);
            var title = Text(card, $"You classified {correct} of {_solutions.Count} correctly", 28, textColor, FontStyles.Bold, TextAlignmentOptions.Left);
            Fixed(title.rectTransform, -1, 38);

            var head = NewRow(card, 44, panelColor);
            AddHeader(head, "Tube", 90); AddHeader(head, "Solution", 270); AddHeader(head, "Formula", 120);
            AddHeader(head, "Type", 110); AddHeader(head, "pH", 80); AddHeader(head, "Your answer", 170);

            for (int i = 0; i < _solutions.Count; i++)
            {
                var s = _solutions[i];
                var r = NewRow(card, 54, rowColor);
                bool ok = IsCorrect(i);
                string answer = _conclusionIndex[i] == 0 ? "Not set" : ConclusionOptions[_conclusionIndex[i]];
                Cellf(r, $"Tube {i + 1}", 90, textColor, FontStyles.Bold);
                Cellf(r, s.Name, 270, textColor, FontStyles.Normal);
                Cellf(r, s.Formula, 120, accent2Color, FontStyles.Bold);
                Cellf(r, Capitalize(s.Type), 110, textColor, FontStyles.Normal);
                Cellf(r, s.Ph.ToString("0.#"), 80, accentColor, FontStyles.Bold);
                Cellf(r, (ok ? "Correct · " : "Incorrect · ") + answer, 170, ok ? goodColor : badColor, FontStyles.Bold);
            }

            var spacer = NewRect("Spacer", card);
            spacer.gameObject.AddComponent<LayoutElement>().flexibleHeight = 1;

            TMP_Text closeLabel;
            var close = MakeButton(card, "Close", accentColor, out closeLabel, 56);
            close.onClick.AddListener(() => _disclosure.SetActive(false));
        }

        // =====================================================================
        // Helpers
        // =====================================================================

        private bool IsCorrect(int i)
        {
            if (_conclusionIndex[i] == 0) return false;
            string picked = ConclusionOptions[_conclusionIndex[i]].ToLowerInvariant();
            string actual = (_solutions[i].Type ?? "").ToLowerInvariant();
            if (actual.Contains("acid")) actual = "acid";
            else if (actual.Contains("base") || actual.Contains("alkal")) actual = "base";
            else actual = "neutral";
            return picked == actual;
        }

        private static float ColW(int col)
        {
            switch (col) { case 0: return 110f; case 1: return 130f; case 2: return 150f; case 3: return 140f; default: return 100f; }
        }

        private void SetSubmitLabel(string label)
        {
            if (_submitLabel != null) _submitLabel.text = label; // button stays active so the disclosure can be reopened
        }

        private void SetCell(Cell c, string colorName)
        {
            if (string.IsNullOrEmpty(colorName))
            {
                c.Dot.enabled = false;
                c.Label.text = "—";
                c.Label.color = mutedColor;
                return;
            }
            c.Dot.enabled = true;
            c.Dot.color = ParseColor(colorName);
            c.Label.text = colorName;
            c.Label.color = textColor;
        }

        public static Color ParseColor(string name)
        {
            switch ((name ?? "").Trim().ToLowerInvariant())
            {
                case "red":    return new Color(0.94f, 0.27f, 0.27f);
                case "blue":   return new Color(0.23f, 0.51f, 0.96f);
                case "purple": return new Color(0.66f, 0.33f, 0.97f);
                case "pink":   return new Color(0.93f, 0.28f, 0.60f);
                case "yellow": return new Color(0.92f, 0.70f, 0.03f);
                case "green":  return new Color(0.13f, 0.77f, 0.37f);
                case "orange": return new Color(0.98f, 0.45f, 0.09f);
                case "brown":  return new Color(0.57f, 0.25f, 0.05f);
                case "clear":
                case "colorless": return new Color(0.83f, 0.83f, 0.85f);
                default:       return new Color(0.58f, 0.64f, 0.72f);
            }
        }

        private static string Capitalize(string s) =>
            string.IsNullOrEmpty(s) ? "" : char.ToUpperInvariant(s[0]) + s.Substring(1);

        // ---- UI factory ----

        private static RectTransform NewRect(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        private static void Stretch(RectTransform rt, float l, float r, float t, float b)
        {
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = new Vector2(l, b); rt.offsetMax = new Vector2(-r, -t);
        }

        private static void Fixed(RectTransform rt, float width, float height)
        {
            var le = rt.GetComponent<LayoutElement>() ?? rt.gameObject.AddComponent<LayoutElement>();
            if (width >= 0) { le.minWidth = width; le.preferredWidth = width; }
            if (height >= 0) { le.minHeight = height; le.preferredHeight = height; }
        }

        private RectTransform NewRow(Transform parent, float height, Color bg)
        {
            var rt = NewRect("Row", parent);
            Rounded(rt.gameObject, bg, 16);
            var h = rt.gameObject.AddComponent<HorizontalLayoutGroup>();
            h.padding = new RectOffset(14, 14, 6, 6);
            h.spacing = 8;
            h.childAlignment = TextAnchor.MiddleLeft;
            h.childControlWidth = h.childControlHeight = true;
            h.childForceExpandWidth = false; h.childForceExpandHeight = true;
            Fixed(rt, -1, height);
            return rt;
        }

        private void AddHeader(Transform row, string text, float width)
        {
            var t = Text(row, text.ToUpperInvariant(), 14, mutedColor, FontStyles.Bold, TextAlignmentOptions.Left);
            t.characterSpacing = 3;
            Fixed(t.rectTransform, width, -1);
        }

        private void Cellf(Transform row, string text, float width, Color color, FontStyles style)
        {
            var t = Text(row, text, 18, color, style, TextAlignmentOptions.Left);
            t.textWrappingMode = TextWrappingModes.NoWrap;
            t.overflowMode = TextOverflowModes.Ellipsis;
            Fixed(t.rectTransform, width, -1);
        }

        private TMP_Text Text(Transform parent, string text, float size, Color color, FontStyles style, TextAlignmentOptions align)
        {
            var rt = NewRect("Text", parent);
            var tmp = rt.gameObject.AddComponent<TextMeshProUGUI>();
            tmp.text = text; tmp.fontSize = size; tmp.color = color;
            tmp.fontStyle = style; tmp.alignment = align;
            tmp.textWrappingMode = TextWrappingModes.NoWrap;
            tmp.raycastTarget = false;
            return tmp;
        }

        private Cell ColorCell(Transform row, float width)
        {
            var rt = NewRect("ColorCell", row);
            var h = rt.gameObject.AddComponent<HorizontalLayoutGroup>();
            h.spacing = 8; h.childAlignment = TextAnchor.MiddleLeft;
            h.childControlWidth = h.childControlHeight = true;
            h.childForceExpandWidth = false; h.childForceExpandHeight = false;
            Fixed(rt, width, -1);

            var dotRt = NewRect("Dot", rt);
            var dot = Rounded(dotRt.gameObject, Color.white, 16);
            Fixed(dotRt, 24, 24);

            var label = Text(rt, "—", 20, textColor, FontStyles.Normal, TextAlignmentOptions.Left);
            return new Cell { Dot = dot, Label = label };
        }

        private Button MakeButton(Transform parent, string text, Color accent, out TMP_Text label, float height, float fontSize = 22)
        {
            var rt = NewRect("Button", parent);
            var img = Rounded(rt.gameObject, new Color(accent.r, accent.g, accent.b, 0.22f), 18);
            var outline = rt.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(accent.r, accent.g, accent.b, 0.7f);
            outline.effectDistance = new Vector2(2, -2);

            var btn = rt.gameObject.AddComponent<Button>();
            btn.targetGraphic = img;
            var colors = btn.colors;
            colors.normalColor      = Color.white;
            colors.highlightedColor = new Color(1.4f, 1.4f, 1.4f, 1f);
            colors.pressedColor     = new Color(0.7f, 0.7f, 0.7f, 1f);
            colors.disabledColor    = new Color(0.5f, 0.5f, 0.5f, 0.6f);
            colors.fadeDuration = 0.08f;
            btn.colors = colors;

            label = Text(rt, text, fontSize, textColor, FontStyles.Bold, TextAlignmentOptions.Center);
            Stretch(label.rectTransform, 0, 0, 0, 0);
            if (height > 0) Fixed(rt, -1, height);
            return btn;
        }

        private static Image Rounded(GameObject go, Color color, int radius)
        {
            var img = go.GetComponent<Image>() ?? go.AddComponent<Image>();
            img.sprite = GetRoundedSprite();
            img.type = Image.Type.Sliced;
            img.pixelsPerUnitMultiplier = 24f / radius; // sprite border is 24px
            img.color = color;
            return img;
        }

        /// <summary>Procedural 64px rounded-rect, 9-sliced. Avoids depending on editor-only built-in sprites.</summary>
        private static Sprite GetRoundedSprite()
        {
            if (_rounded != null) return _rounded;
            const int size = 64, r = 24;
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var px = new Color32[size * size];
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float dx = Mathf.Max(r - x - 0.5f, x + 0.5f - (size - r), 0f);
                float dy = Mathf.Max(r - y - 0.5f, y + 0.5f - (size - r), 0f);
                float d = Mathf.Sqrt(dx * dx + dy * dy);
                byte a = (byte)(Mathf.Clamp01(r - d + 0.5f) * 255f);
                px[y * size + x] = new Color32(255, 255, 255, a);
            }
            tex.SetPixels32(px);
            tex.Apply();
            _rounded = Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f, 0,
                SpriteMeshType.FullRect, new Vector4(r, r, r, r));
            return _rounded;
        }
    }
}
