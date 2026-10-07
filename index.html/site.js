"use strict";

function createServiceCard(service, index, template) {
  const card = template.cloneNode(true);
  const title = card.querySelector("h3");
  const description = card.querySelector("p");
  const link = card.querySelector("a");
  card.querySelector(".service-number").textContent = String(index + 1).padStart(2, "0");
  title.textContent = service.title;
  description.textContent = service.description;
  link.href = `mailto:jeftech12345@hotmail.com?subject=${encodeURIComponent(`${service.title} enquiry`)}`;
  link.setAttribute("aria-label", `Enquire about ${service.title}`);
  return card;
}

function createProjectCard(project, index) {
  const figure = document.createElement("figure");
  figure.className = "work-card";

  const imageContainer = document.createElement("div");
  imageContainer.className = "work-image";
  const image = document.createElement("img");
  image.src = project.image_url;
  image.alt = project.alt_text;
  image.loading = "lazy";
  image.decoding = "async";
  imageContainer.append(image);

  const number = document.createElement("span");
  number.className = "work-index";
  number.textContent = String(index + 1).padStart(2, "0");
  imageContainer.append(number);

  const caption = document.createElement("figcaption");
  const category = document.createElement("span");
  category.className = "work-category";
  category.textContent = project.category;
  const title = document.createElement("strong");
  title.textContent = project.title;
  caption.append(category, title);
  figure.append(imageContainer, caption);
  return figure;
}

async function loadWebsiteContent() {
  const response = await fetch("/api/content", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Content request failed with HTTP ${response.status}.`);
  const content = await response.json();

  const serviceGrid = document.querySelector("#service-grid");
  if (serviceGrid && Array.isArray(content.services) && content.services.length) {
    const template = serviceGrid.querySelector(".service-card");
    serviceGrid.replaceChildren(...content.services.map((service, index) => createServiceCard(service, index, template)));
  }

  const gallery = document.querySelector("#work-gallery");
  if (gallery && Array.isArray(content.projects) && content.projects.length) {
    gallery.replaceChildren(...content.projects.map(createProjectCard));
  }
}

window.jeftechContentReady = loadWebsiteContent()
  .catch((error) => {
    console.error("Could not load the latest services and work gallery from the website backend.", error);
  })
  .finally(() => {
    window.dispatchEvent(new Event("jeftech:content-ready"));
  });

document.querySelectorAll(".mobile-menu nav a").forEach((link) => {
  link.addEventListener("click", () => {
    link.closest(".mobile-menu").open = false;
  });
});

const enquiryForm = document.querySelector("#enquiry-form");
if (enquiryForm) {
  const feedback = document.querySelector("#enquiry-feedback");
  enquiryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = enquiryForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    feedback.textContent = "Sending your enquiry…";
    try {
      const formData = new FormData(enquiryForm);
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(Object.fromEntries(formData.entries()))
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Request failed with HTTP ${response.status}.`);
      enquiryForm.reset();
      feedback.textContent = "Thank you. Your enquiry has been sent; we’ll be in touch.";
    } catch (error) {
      console.error("Could not send customer enquiry.", error);
      feedback.textContent = error.message || "We couldn’t send your enquiry. Please email or WhatsApp us instead.";
    } finally {
      submitButton.disabled = false;
    }
  });
}
