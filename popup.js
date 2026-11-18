/**
 * ChatGPT RTL - Popup Logic
 * Handles user preferences, and storage synchronization.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const toggleAutoResponse = document.getElementById('toggleAutoResponse');
  const toggleAutoInput = document.getElementById('toggleAutoInput');
  const toggleForceCodeMath = document.getElementById('toggleForceCodeMath');
  const toggleVazirmatn = document.getElementById('toggleVazirmatn');

  // Load saved preferences from chrome.storage.sync
  const defaults = {
    autoDetectResponse: true,
    autoDetectInput: true,
    forceCodeMathLTR: true,
    useVazirmatn: false
  };

  try {
    const stored = await chrome.storage.sync.get(defaults);
    toggleAutoResponse.checked = stored.autoDetectResponse;
    toggleAutoInput.checked = stored.autoDetectInput;
    toggleForceCodeMath.checked = stored.forceCodeMathLTR;
    toggleVazirmatn.checked = stored.useVazirmatn;
  } catch (err) {
    console.error('Failed to load settings:', err);
  }

  // Save changes on toggle
  toggleAutoResponse.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ autoDetectResponse: toggleAutoResponse.checked });
    } catch (err) {
      console.error('Failed to save autoDetectResponse:', err);
    }
  });

  toggleAutoInput.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ autoDetectInput: toggleAutoInput.checked });
    } catch (err) {
      console.error('Failed to save autoDetectInput:', err);
    }
  });

  toggleForceCodeMath.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ forceCodeMathLTR: toggleForceCodeMath.checked });
    } catch (err) {
      console.error('Failed to save forceCodeMathLTR:', err);
    }
  });

  toggleVazirmatn.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ useVazirmatn: toggleVazirmatn.checked });
    } catch (err) {
      console.error('Failed to save useVazirmatn:', err);
    }
  });
});
