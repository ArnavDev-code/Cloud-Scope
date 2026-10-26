// Change this if your FastAPI server uses a different host or port.
const API_URL = "http://127.0.0.1:8000/predict";
const form = document.getElementById("predictionForm");
const submitButton = document.getElementById("submitButton");
const emptyState = document.getElementById("emptyState");
const resultData = document.getElementById("resultData");
const resultStatus = document.getElementById("resultStatus");
const toast = document.getElementById("toast");
let toastTimer;

document.getElementById("apiUrlLabel").textContent = API_URL;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function setConnection(state, label) {
  const indicator = document.querySelector(".api-indicator");
  indicator.classList.remove("online", "offline");
  if (state === "online") indicator.classList.add("online");
  if (state === "offline") indicator.classList.add("offline");
  document.getElementById("connectionLabel").textContent = label;
  document.getElementById("apiStatus").textContent =
    state === "online" ? "Connected" : state === "offline" ? "Connection failed" : "Ready to connect";
}

function numberOrNull(id) {
  const raw = document.getElementById(id).value.trim();
  return raw === "" ? null : Number(raw);
}

function validateForm() {
  const quantity = numberOrNull("usage_quantity");
  const duration = numberOrNull("usage_duration_hours");
  const cpu = numberOrNull("cpu_utilization");
  const memory = numberOrNull("memory_utilization");
  const network = numberOrNull("network_inbound_GB");
  if (quantity === null || quantity < 0 || !Number.isFinite(quantity)) {
    throw new Error("Enter a valid, non-negative usage quantity.");
  }
  if (duration === null || duration < 0 || !Number.isFinite(duration)) {
    throw new Error("Enter a valid, non-negative usage duration.");
  }
  if (network === null || network < 0 || !Number.isFinite(network)) {
    throw new Error("Enter a valid, non-negative inbound network value.");
  }
  for (const [label, value] of [["CPU utilization", cpu], ["Memory utilization", memory]]) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      throw new Error(`${label} must be between 0 and 100.`);
    }
  }
}

function buildPayload() {
  return {
    service_name: document.getElementById("service_name").value,
    usage_quantity: numberOrNull("usage_quantity"),
    usage_unit: document.getElementById("usage_unit").value,
    region_zone: document.getElementById("region_zone").value.trim(),
    cpu_utilization: numberOrNull("cpu_utilization"),
    memory_utilization: numberOrNull("memory_utilization"),
    network_inbound_GB: numberOrNull("network_inbound_GB"),
    usage_duration_hours: numberOrNull("usage_duration_hours"),
    usage_month: Number(document.getElementById("usage_month").value),
    usage_day_of_week: Number(document.getElementById("usage_day_of_week").value)
  };
}

function formatINR(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function displayResult(data) {
  const costs = data.predicted_cost_inr;
  if (!costs || !["low", "median", "high"].every(k => Number.isFinite(Number(costs[k])))) {
    throw new Error("The API response did not contain valid low, median, and high predictions.");
  }
  document.getElementById("medianCost").textContent = formatINR(costs.median);
  document.getElementById("lowCost").textContent = `₹${formatINR(costs.low)}`;
  document.getElementById("highCost").textContent = `₹${formatINR(costs.high)}`;
  document.getElementById("outService").textContent = data.service_name ?? "—";
  document.getElementById("outUnit").textContent = data.usage_unit ?? "—";
  emptyState.classList.add("hidden");
  resultData.classList.remove("hidden");
  resultStatus.textContent = "PREDICTION READY";
  resultStatus.classList.add("success");
  document.getElementById("resultPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    validateForm();
    const payload = buildPayload();
    submitButton.disabled = true;
    submitButton.querySelector("span:first-child").textContent = "Calculating…";
    resultStatus.textContent = "RUNNING MODEL";
    resultStatus.classList.remove("success");

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
      throw new Error(detail || `Request failed (${response.status}).`);
    }

    displayResult(body);
    setConnection("online", "Connected");
    showToast("Cost estimate generated successfully.");
  } catch (error) {
    resultStatus.textContent = "REQUEST FAILED";
    showToast(error instanceof Error ? error.message : "Could not reach the prediction API.", true);
    if (error instanceof TypeError) {
      setConnection("offline", "Unavailable");
      showToast("Could not reach FastAPI. Check that the backend is running and CORS is enabled.", true);
    }
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span:first-child").textContent = "Estimate cloud cost";
  }
});

document.getElementById("testApiButton").addEventListener("click", async () => {
  // FastAPI's /docs is commonly available when the app is running.
  try {
    const response = await fetch(API_URL.replace(/\/predict\/?$/, "/openapi.json"), { method: "GET" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setConnection("online", "Connected");
    showToast("FastAPI is reachable.");
  } catch (_) {
    setConnection("offline", "Unavailable");
    showToast("API test failed. Start FastAPI and confirm the API URL and CORS settings.", true);
  }
});

document.getElementById("resetButton").addEventListener("click", () => {
  setTimeout(() => {
    document.getElementById("network_inbound_GB").value = "0";
    document.getElementById("region_zone").value = "asia-south1";
    document.getElementById("usage_month").value = String(new Date().getMonth() + 1);
    emptyState.classList.remove("hidden");
    resultData.classList.add("hidden");
    resultStatus.textContent = "AWAITING INPUT";
    resultStatus.classList.remove("success");
  }, 0);
});

document.getElementById("newEstimateButton").addEventListener("click", () => {
  document.getElementById("usage_quantity").focus();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
});

// Select the current month by default.
document.getElementById("usage_month").value = String(new Date().getMonth() + 1);
