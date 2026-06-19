const CONTACT_EMAIL = "athletetyreseh@gmail.com";
const scriptUrl = new URL(document.currentScript?.src || "script.js", window.location.href);
const siteRoot = new URL(".", scriptUrl);
const isHomePage = document.body.classList.contains("home-page");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Secondary pages use one quiet corner control instead of recreating homepage navigation.
if (!isHomePage) {
  document.querySelector(".site-header")?.remove();
  document.querySelector(".scroll-progress")?.remove();

  const homeLink = document.createElement("a");
  homeLink.className = "page-home";
  homeLink.href = new URL("index.html", siteRoot).href;
  homeLink.setAttribute("aria-label", "Back to Tyrese Hawthorne portfolio");
  homeLink.innerHTML = `<img src="${new URL("assets/th-logo-mark.png", siteRoot).href}" alt="TH" />`;
  document.body.prepend(homeLink);
}

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = new Date().getFullYear();
});

// Show the branded intro once per browser session, then keep repeat visits immediate.
const curtain = document.querySelector(".transition-curtain");
let introSeen = false;
try {
  introSeen = sessionStorage.getItem("th-intro-seen") === "true";
  sessionStorage.setItem("th-intro-seen", "true");
} catch {
  introSeen = false;
}

const isDirectSectionLink = window.location.hash && window.location.hash !== "#home";

if (curtain && (introSeen || prefersReducedMotion.matches || isDirectSectionLink)) {
  curtain.remove();
}

requestAnimationFrame(() => document.body.classList.add("is-ready"));

const story = document.querySelector(".snap-story");
const sections = Array.from(document.querySelectorAll("[data-section]"));
const sectionLinks = Array.from(document.querySelectorAll("[data-section-link]"));
const sectionIndex = document.querySelector("[data-section-index]");

const setCurrentSection = (sectionId) => {
  const position = sections.findIndex((section) => section.dataset.section === sectionId);

  sectionLinks.forEach((link) => {
    const active = link.dataset.sectionLink === sectionId;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  sections.forEach((section) => {
    section.classList.toggle("is-current", section.dataset.section === sectionId);
  });

  if (sectionIndex && position >= 0) {
    sectionIndex.textContent = `${String(position + 1).padStart(2, "0")} / ${String(sections.length).padStart(2, "0")}`;
  }
};

if (story && sections.length) {
  const directSection = document.querySelector(window.location.hash);
  if (directSection && window.location.hash !== "#home") {
    story.style.scrollBehavior = "auto";
    story.scrollTop = directSection.offsetTop;
    requestAnimationFrame(() => story.style.removeProperty("scroll-behavior"));
  }

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (visible) setCurrentSection(visible.target.dataset.section);
    },
    { root: story, threshold: [0.35, 0.55, 0.75] }
  );

  sections.forEach((section) => sectionObserver.observe(section));
  setCurrentSection((window.location.hash || "#home").slice(1));
}

// Section content reveals when its snap panel enters the viewport.
const revealItems = Array.from(document.querySelectorAll("[data-reveal]"));
if (revealItems.length) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      });
    },
    { root: story || null, threshold: 0.18 }
  );

  const initialSectionId = (window.location.hash || "#home").slice(1);
  document.querySelectorAll(`#${initialSectionId} [data-reveal]`).forEach((item) => item.classList.add("is-visible"));
  revealItems.forEach((item) => revealObserver.observe(item));
  document.documentElement.classList.add("motion-enabled");
}

// Accessible Projects / Systems / Insights tab interface.
const workTabs = Array.from(document.querySelectorAll("[data-work-tab]"));
const workPanels = Array.from(document.querySelectorAll("[data-work-panel]"));

const activateWorkTab = (tabName, moveFocus = false) => {
  workTabs.forEach((tab) => {
    const selected = tab.dataset.workTab === tabName;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && moveFocus) tab.focus();
  });

  workPanels.forEach((panel) => {
    const selected = panel.dataset.workPanel === tabName;
    panel.hidden = !selected;
    panel.classList.toggle("is-active", selected);
  });
};

workTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateWorkTab(tab.dataset.workTab));
  tab.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % workTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + workTabs.length) % workTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = workTabs.length - 1;
    activateWorkTab(workTabs[nextIndex].dataset.workTab, true);
  });
});

if (workTabs.length) activateWorkTab("projects");

// Build a mathematically identical second logo set for a seamless, never-ending loop.
const systemLoopSets = document.querySelectorAll(".system-loop-set");
if (systemLoopSets.length === 2 && !systemLoopSets[1].children.length) {
  systemLoopSets[1].innerHTML = systemLoopSets[0].innerHTML;
  systemLoopSets[1].querySelectorAll("button").forEach((button) => {
    button.tabIndex = -1;
    button.setAttribute("aria-hidden", "true");
  });
}

const systemDetail = document.querySelector("[data-system-detail]");
const systemStage = document.querySelector(".systems-stage");

systemStage?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-system]");
  if (!button || !systemDetail) return;

  const systemName = button.dataset.system || "Selected system";
  const description = button.dataset.description || "Operational technology used in security environments.";

  document.querySelectorAll("[data-system]").forEach((item) => {
    item.classList.toggle("is-selected", item.dataset.system === systemName);
  });

  systemDetail.querySelector("span").textContent = "Selected system";
  systemDetail.querySelector("h3").textContent = systemName;
  systemDetail.querySelector("p").textContent = description;
});

// Lightweight scroll-linked portrait movement; desktop only and rAF-throttled.
const parallaxImage = document.querySelector("[data-parallax-media] img");
let parallaxFrame = 0;

const updateParallax = () => {
  parallaxFrame = 0;
  if (!story || !parallaxImage || prefersReducedMotion.matches || window.innerWidth <= 820) return;
  const progress = Math.min(Math.max(story.scrollTop / Math.max(window.innerHeight, 1), 0), 1);
  parallaxImage.style.transform = `translate3d(0, ${progress * 24}px, 0) scale(1.055)`;
};

story?.addEventListener(
  "scroll",
  () => {
    if (parallaxFrame) return;
    parallaxFrame = requestAnimationFrame(updateParallax);
  },
  { passive: true }
);

window.addEventListener("resize", updateParallax);
updateParallax();

// Static contact form: prepare a message without storing or transmitting form data.
const contactForm = document.querySelector("[data-contact-form]");
const formNote = document.querySelector("[data-form-note]");

contactForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(contactForm);
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const subject = encodeURIComponent("Portfolio inquiry for Tyrese Hawthorne");
  const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);

  window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  if (formNote) formNote.textContent = "Your email app should open with a prepared message.";
});
