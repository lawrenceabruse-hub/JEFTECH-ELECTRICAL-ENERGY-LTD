"use strict";

const loginPanel = document.querySelector("#login-panel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const loginFeedback = document.querySelector("#login-feedback");

function setFeedback(element, message, kind = "") {
  element.textContent = message;
  element.classList.toggle("is-error", kind === "error");
  element.classList.toggle("is-success", kind === "success");
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function addAction(container, label, className, action) {
  const button = node("button", className, label);
  button.type = "button";
  button.addEventListener("click", action);
  container.append(button);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

async function loadEnquiries() {
  const list = document.querySelector("#enquiry-list");
  const feedback = document.querySelector("#enquiry-feedback");
  const status = document.querySelector("#enquiry-filter").value;
  try {
    const path = status ? `/api/admin/enquiries?status=${encodeURIComponent(status)}` : "/api/admin/enquiries";
    const { enquiries } = await api(path);
    list.replaceChildren();
    if (!enquiries.length) {
      list.append(node("p", "empty-state", "No enquiries found."));
      return;
    }
    for (const enquiry of enquiries) {
      const card = node("article", "enquiry-card");
      const details = node("div");
      details.append(node("h3", "", enquiry.name));
      const metadata = node("div", "enquiry-meta");
      const email = node("a", "", enquiry.email);
      email.href = `mailto:${enquiry.email}`;
      metadata.append(email);
      if (enquiry.phone) {
        const phone = node("a", "", enquiry.phone);
        phone.href = `tel:${enquiry.phone.replace(/[^\d+]/g, "")}`;
        metadata.append(phone);
      }
      metadata.append(node("span", "", `Received ${formatDate(enquiry.created_at)}`));
      if (enquiry.service) metadata.append(node("span", "", `Service: ${enquiry.service}`));
      details.append(metadata, node("p", "enquiry-message", enquiry.message));

      const select = document.createElement("select");
      select.setAttribute("aria-label", `Update status for enquiry from ${enquiry.name}`);
      for (const value of ["new", "contacted", "closed"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value[0].toUpperCase() + value.slice(1);
        option.selected = value === enquiry.status;
        select.append(option);
      }
      select.addEventListener("change", async () => {
        select.disabled = true;
        try {
          await api(`/api/admin/enquiries/${enquiry.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: select.value })
          });
          setFeedback(feedback, "Enquiry status updated.", "success");
          await loadEnquiries();
        } catch (error) {
          setFeedback(feedback, error.message, "error");
          select.disabled = false;
        }
      });
      card.append(details, select);
      list.append(card);
    }
  } catch (error) {
    setFeedback(feedback, error.message, "error");
  }
}

function showEditor(form, fields, values, saveLabel, submitAction) {
  form.replaceChildren();
  form.hidden = false;
  form.dataset.itemId = values.id || "";
  for (const field of fields) {
    const label = node("label", field.wide ? "wide-field" : "", field.label);
    let input;
    if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = field.rows || 4;
    } else if (field.type === "number") {
      input = document.createElement("input");
      input.type = "number";
      input.min = "0";
    } else {
      input = document.createElement("input");
      input.type = field.type || "text";
    }
    input.name = field.name;
    input.required = field.required !== false;
    input.maxLength = field.maxLength || 1000;
    input.value = values[field.name] ?? "";
    label.append(input);
    form.append(label);
  }
  const actions = node("div", "editor-actions");
  const save = node("button", "button button-primary", saveLabel);
  save.type = "submit";
  const cancel = node("button", "button button-secondary", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => { form.hidden = true; });
  actions.append(save, cancel);
  form.append(actions);
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await submitAction(Object.fromEntries(new FormData(form).entries()), form.dataset.itemId);
      form.hidden = true;
    } catch (error) {
      const feedbackId = form.id === "service-form" ? "service-feedback" : "project-feedback";
      setFeedback(document.querySelector(`#${feedbackId}`), error.message, "error");
    } finally {
      save.disabled = false;
    }
  };
}

async function loadServices() {
  const feedback = document.querySelector("#service-feedback");
  try {
    const { services } = await api("/api/content");
    const list = document.querySelector("#service-list");
    list.replaceChildren();
    if (!services.length) list.append(node("p", "empty-state", "No services have been added."));
    for (const service of services) {
      const row = node("article", "content-row");
      const details = node("div", "content-row-copy");
      details.append(node("h3", "", service.title), node("p", "", service.description));
      const actions = node("div", "row-actions");
      addAction(actions, "Edit", "", () => {
        showEditor(document.querySelector("#service-form"), [
          { name: "title", label: "Service name", maxLength: 120 },
          { name: "description", label: "Description", type: "textarea", wide: true }
        ], service, "Save service", async (data, id) => {
          await api(`/api/admin/services/${id}`, { method: "PUT", body: JSON.stringify(data) });
          setFeedback(feedback, "Service saved.", "success");
          await loadServices();
        });
      });
      addAction(actions, "Delete", "delete-button", async () => {
        if (!window.confirm(`Remove the service “${service.title}” from the website?`)) return;
        try {
          await api(`/api/admin/services/${service.id}`, { method: "DELETE" });
          setFeedback(feedback, "Service removed.", "success");
          await loadServices();
        } catch (error) {
          setFeedback(feedback, error.message, "error");
        }
      });
      row.append(details, actions);
      list.append(row);
    }
  } catch (error) {
    setFeedback(feedback, error.message, "error");
  }
}

async function loadProjects() {
  const feedback = document.querySelector("#project-feedback");
  try {
    const { projects } = await api("/api/content");
    const list = document.querySelector("#project-list");
    list.replaceChildren();
    if (!projects.length) list.append(node("p", "empty-state", "No gallery items have been added."));
    for (const project of projects) {
      const row = node("article", "content-row");
      const details = node("div", "content-row-main");
      const image = document.createElement("img");
      image.src = project.image_url;
      image.alt = project.alt_text;
      image.loading = "lazy";
      const copy = node("div", "content-row-copy");
      copy.append(node("h3", "", project.title), node("p", "", `${project.category} · ${project.image_url}`));
      details.append(image, copy);
      const actions = node("div", "row-actions");
      addAction(actions, "Edit", "", () => {
        showEditor(document.querySelector("#project-form"), [
          { name: "title", label: "Title", maxLength: 180 },
          { name: "category", label: "Category", maxLength: 120 },
          { name: "image_url", label: "Image URL or /images/file.jpg", maxLength: 1000, wide: true },
          { name: "alt_text", label: "Image description (accessibility)", maxLength: 300, wide: true }
        ], project, "Save gallery item", async (data, id) => {
          await api(`/api/admin/projects/${id}`, { method: "PUT", body: JSON.stringify(data) });
          setFeedback(feedback, "Gallery item saved.", "success");
          await loadProjects();
        });
      });
      addAction(actions, "Delete", "delete-button", async () => {
        if (!window.confirm(`Remove “${project.title}” from the work gallery?`)) return;
        try {
          await api(`/api/admin/projects/${project.id}`, { method: "DELETE" });
          setFeedback(feedback, "Gallery item removed.", "success");
          await loadProjects();
        } catch (error) {
          setFeedback(feedback, error.message, "error");
        }
      });
      row.append(details, actions);
      list.append(row);
    }
  } catch (error) {
    setFeedback(feedback, error.message, "error");
  }
}

async function showDashboard(email) {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  document.querySelector("#admin-email").textContent = email;
  await Promise.all([loadEnquiries(), loadServices(), loadProjects()]);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  button.disabled = true;
  try {
    const result = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(loginForm).entries()))
    });
    loginForm.reset();
    await showDashboard(result.email);
  } catch (error) {
    setFeedback(loginFeedback, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
    dashboard.hidden = true;
    loginPanel.hidden = false;
    setFeedback(loginFeedback, "You have signed out.", "success");
  } catch (error) {
    window.alert(error.message);
  }
});

document.querySelector("#enquiry-filter").addEventListener("change", loadEnquiries);

document.querySelector("#new-service-button").addEventListener("click", () => {
  showEditor(document.querySelector("#service-form"), [
    { name: "title", label: "Service name", maxLength: 120 },
    { name: "description", label: "Description", type: "textarea", wide: true }
  ], {}, "Add service", async (data) => {
    await api("/api/admin/services", { method: "POST", body: JSON.stringify(data) });
    setFeedback(document.querySelector("#service-feedback"), "Service added.", "success");
    await loadServices();
  });
});

document.querySelector("#new-project-button").addEventListener("click", () => {
  showEditor(document.querySelector("#project-form"), [
    { name: "title", label: "Title", maxLength: 180 },
    { name: "category", label: "Category", maxLength: 120 },
    { name: "image_url", label: "Image URL or /images/file.jpg", maxLength: 1000, wide: true },
    { name: "alt_text", label: "Image description (accessibility)", maxLength: 300, wide: true }
  ], {}, "Add gallery item", async (data) => {
    await api("/api/admin/projects", { method: "POST", body: JSON.stringify(data) });
    setFeedback(document.querySelector("#project-feedback"), "Gallery item added.", "success");
    await loadProjects();
  });
});

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const result = await api("/api/admin/password", {
      method: "PUT",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    form.reset();
    setFeedback(document.querySelector("#password-feedback"), result.message, "success");
  } catch (error) {
    setFeedback(document.querySelector("#password-feedback"), error.message, "error");
  } finally {
    button.disabled = false;
  }
});

api("/api/admin/session")
  .then((session) => showDashboard(session.email))
  .catch((error) => {
    if (!(error instanceof Error) || error.status !== 401) {
      console.error("Could not check the admin session.", error);
      setFeedback(loginFeedback, error.message, "error");
    }
  });
