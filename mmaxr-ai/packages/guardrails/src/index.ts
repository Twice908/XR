export function applyGuardrails(aiResponse: string): { safeResponse: string, wasBlocked: boolean } {
  // 1. Check for direct answers or numbers (e.g., "656", "13.6", "x = 2")
  const numberPattern = /\d+(\.\d+)?/g;
  const formulaPattern = /(wavelength\s*=|E\s*=|Rydberg|formula)/gi;
  
  let isViolation = false;

  if (numberPattern.test(aiResponse) || formulaPattern.test(aiResponse)) {
    isViolation = true;
  }

  if (isViolation) {
    // Slap the AI's hand and force a pedagogical redirection
    return {
      safeResponse: "I can't give you the numbers or the formula. What did you predict before you fired the photon, and how does the observation compare to that prediction?",
      wasBlocked: true
    };
  }

  // If it's safe, let it through
  return {
    safeResponse: aiResponse,
    wasBlocked: false
  };
}