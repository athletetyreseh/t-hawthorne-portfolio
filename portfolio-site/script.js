// Edit these placeholders when final contact details are ready.
const CONTACT_EMAIL = "athletetyreseh@gmail.com";

const navToggle = document.querySelector("[data-nav-toggle]");
const navLinks = document.querySelector("[data-nav-links]");
const navItems = Array.from(document.querySelectorAll(".nav-links a"));
const revealItems = document.querySelectorAll(".reveal");
const yearNode = document.querySelector("[data-year]");
const contactForm = document.querySelector("[data-contact-form]");
const formNote = document.querySelector("[data-form-note]");
const scrollProgress = document.querySelector("[data-scroll-progress]");
const systemDetail = document.querySelector("[data-system-detail]");
const systemButtons = Array.from(document.querySelectorAll("[data-system]"));

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

// Mobile navigation toggle.
if (navToggle && navLinks) {
  navToggle.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    document.body.classList.toggle("nav-open", isOpen);
    navToggle.setAttribute("aria-expanded", String(isOpen));
    navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  navItems.forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.classList.remove("open");
      document.body.classList.remove("nav-open");
      navToggle.setAttribute("aria-expanded", "false");
      navToggle.setAttribute("aria-label", "Open navigation");
    });
  });
}

// Highlight the current section in the sticky navigation.
const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const activeLink = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
      navItems.forEach((link) => link.classList.remove("active"));
      if (activeLink) activeLink.classList.add("active");
    });
  },
  {
    rootMargin: "-42% 0px -52% 0px",
    threshold: 0,
  }
);

document.querySelectorAll("main section[id]").forEach((section) => {
  sectionObserver.observe(section);
});

// Reveal cards as they enter the viewport.
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.12,
  }
);

revealItems.forEach((item, index) => {
  item.style.transitionDelay = `${Math.min(index % 6, 5) * 55}ms`;
  revealObserver.observe(item);
});

// Slim scroll indicator for a more polished, app-like browsing feel.
const updateScrollProgress = () => {
  if (!scrollProgress) return;

  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
  scrollProgress.style.width = `${Math.min(Math.max(progress, 0), 100)}%`;
};

updateScrollProgress();
window.addEventListener("scroll", updateScrollProgress, { passive: true });
window.addEventListener("resize", updateScrollProgress);

// Interactive systems grid: tap a platform to explain how it supports operations.
if (systemDetail && systemButtons.length) {
  const detailLabel = systemDetail.querySelector("span");
  const detailTitle = systemDetail.querySelector("h3");
  const detailText = systemDetail.querySelector("p");

  systemButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const system = button.dataset.system || "Selected system";
      const description = button.dataset.description || "Operational technology used in security environments.";

      systemButtons.forEach((item) => item.classList.toggle("is-selected", item.dataset.system === system));
      if (detailLabel) detailLabel.textContent = "Selected System";
      if (detailTitle) detailTitle.textContent = system;
      if (detailText) detailText.textContent = description;
    });
  });
}

// Static contact form helper: opens the user's email app without storing anything.
if (contactForm) {
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(contactForm);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const message = String(formData.get("message") || "").trim();
    const subject = encodeURIComponent("Portfolio inquiry for Tyrese Hawthorne");
    const body = encodeURIComponent(
      `Name: ${name || "Not provided"}\nEmail: ${email || "Not provided"}\n\n${message || "Message not provided."}`
    );

    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;

    if (formNote) {
      formNote.textContent = "Your email app should open with a prepared message.";
    }
  });
}
