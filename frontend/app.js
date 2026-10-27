/* app.js */

"use strict";

/* ---------- Configuration ---------- */

const API_URL = "https://cloud-scope.onrender.com/predict";
const HEALTH_URL = "https://cloud-scope.onrender.com/";
const REQUEST_TIMEOUT_MS = 90_000;
const COLD_START_NOTICE_MS = 4_000;

/* ---------- DOM references ---------- */

const form = document.getElementById("estimate-form");
const submitButton = document.getElementById("submit-button");
const buttonLabel = submitButton.querySelector(".button-label");

const loadExampleButton = document.getElementById("load-example");
const resetButton = document.getElementById("reset-form");
const runAnotherButton = document.getElementById("run-another");
const retryButton = document.getElementById("retry-estimate");

const formFeedback = document.getElementById("form-feedback");

const emptyResult = document.getElementById("empty-result");
const loadingResult = document.getElementById("loading-result");
const loadingTitle = document.getElementById("loading-title");
const loadingDescription = document.getElementById("loading-description");
const estimateResult = document.getElementById("estimate-result");
const errorResult = document.getElementById("error-result");

const errorTitle = document.getElementById("error-title");
const errorDescription = document.getElementById("error-description");

const medianAmount = document.getElementById("median-amount");
const lowAmount = document.getElementById("low-amount");
const highAmount = document.getElementById("high-amount");

const rangeTrack = document.getElementById("range-track");
const rangeFill = document.getElementById("range-fill");
const rangeMarker = document.getElementById("range-marker");

const resultService = document.getElementById("result-service");
const resultUnit = document.getElementById("result-unit");
const resultRegion = document.getElementById("result-region");

/* ---------- State ---------- */

let requestInProgress = false;
let lastSuccessfulProfile = null;

/* ---------- Formatting ---------- */

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const percentFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2
});

function formatINR(value) {
  return inrFormatter.format(value);
}

/* ---------- Form helpers ---------- */

function getField(name) {
  return form.elements.namedItem(name);
}

function getFieldError(name) {
  return document.getElementById(`${name}-error`);
}

function showFieldError(name, message) {
  const field = getField(name);
  const errorElement = getFieldError(name);

  if (!field || !errorElement) {
    return;
  }

  errorElement.textContent = message;
  field.setAttribute("aria-invalid", "true");
}

function clearFieldError(name) {
  const field = getField(name);
  const errorElement = getFieldError(name);

  if (!field || !errorElement) {
    return;
  }

  errorElement.textContent = "";
  field.removeAttribute("aria-invalid");
}

function clearAllFieldErrors() {
  const fields = [
    "service_name",
    "region_zone",
    "usage_quantity",
    "usage_unit",
    "cpu_utilization",
    "memory_utilization",
    "network_inbound_GB",
    "usage_duration_hours",
    "usage_month",
    "usage_day_of_week"
  ];

  fields.forEach(clearFieldError);
}

function setFormFeedback(message, kind = "") {
  formFeedback.textContent = message;

  if (kind) {
    formFeedback.dataset.kind = kind;
  } else {
    delete formFeedback.dataset.kind;
  }
}

function readNumber(name) {
  const rawValue = getField(name).value.trim();

  if (rawValue === "") {
    return null;
  }

  const value = Number(rawValue);

  return Number.isFinite(value) ? value : null;
}

/* ---------- Validation ---------- */

function validateForm() {
  clearAllFieldErrors();

  const errors = [];

  const quantityRaw = getField("usage_quantity").value.trim();
  const durationRaw = getField("usage_duration_hours").value.trim();
  const networkRaw = getField("network_inbound_GB").value.trim();

  const quantity = readNumber("usage_quantity");
  const duration = readNumber("usage_duration_hours");
  const network = readNumber("network_inbound_GB");

  const cpuRaw = getField("cpu_utilization").value.trim();
  const memoryRaw = getField("memory_utilization").value.trim();

  const cpu = readNumber("cpu_utilization");
  const memory = readNumber("memory_utilization");

  validateRequiredSelection("service_name", "Choose a cloud service.", errors);
  validateRequiredSelection("region_zone", "Choose a region.", errors);
  validateRequiredSelection("usage_unit", "Choose a billing unit.", errors);

  validateNonNegative(
    "usage_quantity",
    quantityRaw,
    quantity,
    "Enter a non-negative usage quantity.",
    errors
  );

  validateNonNegative(
    "usage_duration_hours",
    durationRaw,
    duration,
    "Enter a non-negative duration in hours.",
    errors
  );

  validateNonNegative(
    "network_inbound_GB",
    networkRaw,
    network,
    "Enter a non-negative inbound network value.",
    errors
  );

  validateOptionalPercentage("cpu_utilization", cpuRaw, cpu, errors);
  validateOptionalPercentage("memory_utilization", memoryRaw, memory, errors);

  validateIntegerRange(
    "usage_month",
    1,
    12,
    "Choose a valid month.",
    errors
  );

  validateIntegerRange(
    "usage_day_of_week",
    0,
    6,
    "Choose a valid day of the week.",
    errors
  );

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateRequiredSelection(name, message, errors) {
  const value = getField(name).value;

  if (!value) {
    showFieldError(name, message);
    errors.push(name);
  }
}

function validateNonNegative(name, rawValue, value, message, errors) {
  if (rawValue === "" || value === null || value < 0) {
    showFieldError(name, message);
    errors.push(name);
  }
}

function validateOptionalPercentage(name, rawValue, value, errors) {
  if (rawValue === "") {
    return;
  }

  if (value === null || value < 0 || value > 100) {
    showFieldError(
      name,
      "Enter a percentage between 0 and 100, or leave it blank."
    );

    errors.push(name);
  }
}

function validateIntegerRange(name, minimum, maximum, message, errors) {
  const value = Number(getField(name).value);

  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    showFieldError(name, message);
    errors.push(name);
  }
}

/* ---------- API payload ---------- */

function buildPayload() {
  return {
    service_name: getField("service_name").value,
    usage_quantity: readNumber("usage_quantity"),
    usage_unit: getField("usage_unit").value,
    region_zone: getField("region_zone").value,

    cpu_utilization: readNumber("cpu_utilization"),
    memory_utilization: readNumber("memory_utilization"),

    network_inbound_GB: readNumber("network_inbound_GB"),
    usage_duration_hours: readNumber("usage_duration_hours"),

    usage_month: Number(getField("usage_month").value),
    usage_day_of_week: Number(getField("usage_day_of_week").value)
  };
}

/* ---------- Result panel states ---------- */

function showResultState(state) {
  emptyResult.hidden = state !== "empty";
  loadingResult.hidden = state !== "loading";
  estimateResult.hidden = state !== "success";
  errorResult.hidden = state !== "error";
}

function setLoading(isLoading) {
  requestInProgress = isLoading;

  submitButton.disabled = isLoading;
  submitButton.classList.toggle("is-loading", isLoading);

  submitButton.setAttribute("aria-busy", String(isLoading));

  buttonLabel.textContent = isLoading
    ? "Estimating..."
    : "Estimate cost";

  loadExampleButton.disabled = isLoading;
  resetButton.disabled = isLoading;

  if (isLoading) {
    showResultState("loading");

    loadingTitle.textContent = "Calculating your estimate";
    loadingDescription.textContent =
      "Evaluating the usage profile.";
  }
}

function showError(title, message) {
  errorTitle.textContent = title;
  errorDescription.textContent = message;

  showResultState("error");
}

function showColdStartNotice() {
  if (!requestInProgress) {
    return;
  }

  loadingTitle.textContent = "Waking up the server";
  loadingDescription.textContent =
    "The first request can take up to a minute while the service starts. " +
    "Your estimate is still in progress.";
}

/* ---------- API response validation ---------- */

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validatePredictionResponse(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    return {
      valid: false,
      message: "The server returned an unreadable response. Please try again."
    };
  }

  if (
    typeof data.service_name !== "string" ||
    typeof data.usage_unit !== "string"
  ) {
    return {
      valid: false,
      message: "The server response is missing the service or billing unit."
    };
  }

  const costs = data.predicted_cost_inr;

  if (
    !costs ||
    typeof costs !== "object" ||
    Array.isArray(costs) ||
    !isFiniteNumber(costs.low) ||
    !isFiniteNumber(costs.median) ||
    !isFiniteNumber(costs.high)
  ) {
    return {
      valid: false,
      message: "The server returned an incomplete cost estimate. Please try again."
    };
  }

  if (
    costs.low < 0 ||
    costs.median < 0 ||
    costs.high < 0 ||
    costs.low > costs.median ||
    costs.median > costs.high
  ) {
    return {
      valid: false,
      message:
        "The returned cost range is inconsistent. Please try another estimate."
    };
  }

  return {
    valid: true,
    data
  };
}

/* ---------- Prediction rendering ---------- */

function renderPrediction(data, profile) {
  const costs = data.predicted_cost_inr;

  medianAmount.textContent = formatINR(costs.median);
  lowAmount.textContent = formatINR(costs.low);
  highAmount.textContent = formatINR(costs.high);

  resultService.textContent = data.service_name;
  resultUnit.textContent = data.usage_unit;
  resultRegion.textContent = profile.region_zone;

  /*
   * Place the median marker proportionally between the low and high
   * predictions. Do not assume that the median lies at the midpoint.
   */
  const spread = costs.high - costs.low;

  let medianPosition = 50;

  if (spread > 0) {
    medianPosition =
      ((costs.median - costs.low) / spread) * 100;
  }

  medianPosition = Math.max(0, Math.min(100, medianPosition));

  rangeFill.style.width = "100%";
  rangeMarker.style.left = `${medianPosition}%`;

  rangeTrack.setAttribute(
    "aria-label",
    `Estimated cost range from ${formatINR(costs.low)} to ` +
      `${formatINR(costs.high)}, with median ${formatINR(costs.median)}. ` +
      `The median is ${percentFormatter.format(medianPosition)} percent ` +
      `of the way from the low estimate to the high estimate.`
  );

  showResultState("success");
}

/* ---------- Error interpretation ---------- */

async function readErrorMessage(response) {
  let body;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (body && typeof body.detail === "string" && body.detail.trim()) {
    return body.detail.trim();
  }

  if (body && Array.isArray(body.detail)) {
    const messages = body.detail
      .map((item) => {
        if (item && typeof item.msg === "string") {
          return item.msg;
        }

        return "";
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join(" ");
    }
  }

  if (response.status === 429) {
    return "The service is receiving too many requests. Please wait briefly and retry.";
  }

  if (response.status >= 500) {
    return "The estimation service encountered a server error. Please try again shortly.";
  }

  return `The estimation request failed (HTTP ${response.status}). Please check your inputs and retry.`;
}

function getFriendlyError(error) {
  if (error && error.name === "TimeoutError") {
    return {
      title: "The server took too long to respond.",
      message:
        "The request exceeded 90 seconds. The service may be starting up " +
        "or temporarily unavailable. Please try again."
    };
  }

  if (error && error.name === "AbortError") {
    return {
      title: "The request was interrupted.",
      message: "Please try your estimate again."
    };
  }

  if (error instanceof TypeError) {
    return {
      title: "We couldn't reach the estimation service.",
      message:
        "Check your internet connection and try again. If the problem " +
        "continues, the service may be temporarily unavailable."
    };
  }

  return {
    title: "We couldn't complete the estimate.",
    message:
      error && error.message
        ? error.message
        : "An unexpected error occurred. Please try again."
  };
}

/* ---------- Prediction request ---------- */

async function requestPrediction(payload) {
  const controller = new AbortController();

  let timedOut = false;

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const message = await readErrorMessage(response);

      throw new Error(message);
    }

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The server returned a response that could not be read as JSON."
      );
    }

    const validation = validatePredictionResponse(data);

    if (!validation.valid) {
      throw new Error(validation.message);
    }

    return validation.data;
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(
        "The estimation request exceeded the allowed time."
      );

      timeoutError.name = "TimeoutError";

      throw timeoutError;
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/* ---------- Main submission flow ---------- */

async function handleEstimate(event) {
  event.preventDefault();

  if (requestInProgress) {
    return;
  }

  setFormFeedback("");

  const validation = validateForm();

  if (!validation.valid) {
    setFormFeedback(
      "Please correct the highlighted fields before continuing.",
      "error"
    );

    const firstInvalidField = form.querySelector(
      '[aria-invalid="true"]'
    );

    if (firstInvalidField) {
      firstInvalidField.focus();
    }

    return;
  }

  const payload = buildPayload();

  lastSuccessfulProfile = payload;

  setLoading(true);

  let coldStartTimer;

  try {
    /*
     * Render's free service may sleep between requests.
     * After four seconds, explain the delay without cancelling
     * the request or creating a second prediction.
     */
    coldStartTimer = window.setTimeout(
      showColdStartNotice,
      COLD_START_NOTICE_MS
    );

    const data = await requestPrediction(payload);

    renderPrediction(data, payload);

    setFormFeedback(
      "Estimate generated successfully.",
      "success"
    );
  } catch (error) {
    const friendlyError = getFriendlyError(error);

    showError(
      friendlyError.title,
      friendlyError.message
    );
  } finally {
    if (coldStartTimer !== undefined) {
      window.clearTimeout(coldStartTimer);
    }

    setLoading(false);
  }
}

/* ---------- Example profile ---------- */

function loadExample() {
  if (requestInProgress) {
    return;
  }

  const example = {
    service_name: "Compute Engine",
    region_zone: "asia-south1",
    usage_quantity: "120",
    usage_unit: "Hours",
    cpu_utilization: "65",
    memory_utilization: "72",
    network_inbound_GB: "10",
    usage_duration_hours: "24",
    usage_month: String(new Date().getMonth() + 1),
    usage_day_of_week: "0"
  };

  Object.entries(example).forEach(([name, value]) => {
    getField(name).value = value;
    clearFieldError(name);
  });

  setFormFeedback(
    "Example profile loaded. Adjust the values or estimate this workload.",
    "success"
  );

  showResultState("empty");
}

/* ---------- Reset ---------- */

function resetForm() {
  if (requestInProgress) {
    return;
  }

  form.reset();

  /*
   * The month selector should always default to the current
   * calendar month, including after a reset.
   */
  getField("usage_month").value = String(
    new Date().getMonth() + 1
  );

  getField("usage_day_of_week").value = "0";

  clearAllFieldErrors();
  setFormFeedback("");

  lastSuccessfulProfile = null;

  showResultState("empty");
}

/* ---------- Retry and navigation ---------- */

function retryEstimate() {
  if (requestInProgress) {
    return;
  }

  if (lastSuccessfulProfile) {
    /*
     * Restore the last submitted profile so that a retry uses
     * the same inputs as the failed request.
     */
    Object.entries(lastSuccessfulProfile).forEach(([name, value]) => {
      const field = getField(name);

      if (field) {
        field.value = value === null ? "" : String(value);
        clearFieldError(name);
      }
    });
  }

  handleEstimate(new Event("submit", {
    cancelable: true
  }));
}

function focusEstimator() {
  getField("service_name").focus();

  document.getElementById("form-heading").scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "start"
  });
}

/* ---------- Silent server warm-up ---------- */

function warmUpServer() {
  /*
   * This is intentionally silent: no connection card, toast,
   * or visible success/failure message.
   *
   * A failed health check must not block the estimator. The
   * prediction request handles its own errors and timeout.
   */
  fetch(HEALTH_URL, {
    method: "GET",
    cache: "no-store"
  }).catch(() => {
    // Expected when offline or when the service is waking up.
  });
}

/* ---------- Inline validation cleanup ---------- */

function attachFieldValidation() {
  const fields = form.querySelectorAll("input, select");

  fields.forEach((field) => {
    const clearError = () => {
      clearFieldError(field.name);

      if (form.querySelector('[aria-invalid="true"]')) {
        setFormFeedback(
          "Please correct the remaining highlighted fields.",
          "error"
        );
      } else {
        setFormFeedback("");
      }
    };

    field.addEventListener("input", clearError);
    field.addEventListener("change", clearError);
  });
}

/* ---------- Initialization ---------- */

function initializeApp() {
  getField("usage_month").value = String(
    new Date().getMonth() + 1
  );

  document.getElementById("copyright-year").textContent =
    String(new Date().getFullYear());

  form.addEventListener("submit", handleEstimate);

  loadExampleButton.addEventListener("click", loadExample);
  resetButton.addEventListener("click", resetForm);

  runAnotherButton.addEventListener("click", focusEstimator);
  retryButton.addEventListener("click", retryEstimate);

  attachFieldValidation();

  warmUpServer();
}

initializeApp();