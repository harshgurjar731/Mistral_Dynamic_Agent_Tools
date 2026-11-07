/**
 * The landing page's motion, in one place.
 *
 * Elements opt in with data attributes (``data-a="…"``) and this module does
 * the choreography with GSAP, ScrollTrigger and SplitText. Everything lives in
 * one ``gsap.matchMedia()`` context:
 *
 * - visitors who ask for reduced motion get the finished page, no animation;
 * - pointer effects (tilt, magnetic buttons) only on fine pointers;
 * - all of it is reverted on unmount (``useGSAP``), so nothing leaks into the
 *   app when someone signs in.
 *
 * GSAP runs only in the browser; the server render is the plain page.
 */
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import type { RefObject } from "react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText, ScrollToPlugin, useGSAP);
}

export { gsap, ScrollTrigger, SplitText, useGSAP };

const EASE = "power3.out";
const NAV_OFFSET = 72;

const q = <T extends Element = HTMLElement>(root: Element, sel: string) =>
  Array.from(root.querySelectorAll<T>(sel));

/** Word-by-word, masked heading reveal; re-splits itself on resize. */
function splitReveal(el: HTMLElement, opts: { trigger?: boolean; delay?: number } = {}) {
  return SplitText.create(el, {
    type: "words",
    mask: "words",
    wordsClass: "split-word",
    autoSplit: true,
    onSplit(self) {
      return gsap.from(self.words, {
        yPercent: 115,
        rotate: 3,
        opacity: 0,
        duration: 0.9,
        ease: "expo.out",
        stagger: 0.045,
        delay: opts.delay ?? 0,
        ...(opts.trigger ? { scrollTrigger: { trigger: el, start: "top 85%", once: true } } : {}),
      });
    },
  });
}

function hero(root: HTMLElement) {
  const title = root.querySelector<HTMLElement>('[data-a="hero-title"]');
  const items = q(root, '[data-a="hero-item"]');
  const card = root.querySelector<HTMLElement>('[data-a="hero-card"]');
  const tl = gsap.timeline({ defaults: { ease: EASE } });
  if (title) {
    gsap.set(title, { autoAlpha: 1 });
    splitReveal(title, { delay: 0.1 });
  }
  if (items.length) {
    tl.fromTo(
      items,
      { autoAlpha: 0, y: 26 },
      { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.09 },
      0.45,
    );
  }
  if (card) {
    tl.fromTo(
      card,
      { autoAlpha: 0, y: 70, rotateX: 16, rotateY: -10, scale: 0.94, transformPerspective: 1400 },
      { autoAlpha: 1, y: 0, rotateX: 0, rotateY: 0, scale: 1, duration: 1.3, ease: "expo.out" },
      0.35,
    );
    // Drifts up a little as the page scrolls past it.
    gsap.to(card, {
      yPercent: -10,
      ease: "none",
      scrollTrigger: { trigger: card, start: "top 40%", end: "bottom top", scrub: true },
    });
  }
  return tl;
}

function parallax(root: HTMLElement) {
  for (const el of q(root, '[data-a="parallax"]')) {
    const speed = Number(el.dataset["speed"] ?? 0.2);
    gsap.to(el, {
      yPercent: speed * 100,
      ease: "none",
      scrollTrigger: {
        trigger: el.closest("section") ?? el,
        start: "top top",
        end: "bottom top",
        scrub: true,
      },
    });
  }
}

/** Endless marquee that briefly speeds up (and flips direction) with scrolling. */
function marquee(root: HTMLElement) {
  for (const track of q(root, '[data-a="marquee"]')) {
    const loop = gsap.to(track, { xPercent: -50, duration: 38, ease: "none", repeat: -1 });
    let direction = 1;
    ScrollTrigger.create({
      trigger: track,
      start: "top bottom",
      end: "bottom top",
      onUpdate(self) {
        const v = self.getVelocity();
        if (Math.abs(v) < 20) return;
        direction = v > 0 ? 1 : -1;
        const boost = Math.min(5, 1 + Math.abs(v) / 400);
        gsap.to(loop, { timeScale: boost * direction, duration: 0.25, overwrite: true });
        gsap.to(loop, { timeScale: direction, duration: 1.2, delay: 0.25, ease: "power2.out" });
      },
    });
  }
}

function headings(root: HTMLElement) {
  for (const el of q(root, '[data-a="heading"]')) splitReveal(el, { trigger: true });
}

function reveals(root: HTMLElement) {
  for (const el of q(root, '[data-a="reveal"]')) {
    gsap.fromTo(
      el,
      { autoAlpha: 0, y: 34 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.9,
        ease: EASE,
        delay: Number(el.dataset["delay"] ?? 0),
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      },
    );
  }
}

/** Cards rise in staggered batches as they scroll into view. */
function cards(root: HTMLElement) {
  const els = q(root, '[data-a="card"]');
  if (!els.length) return;
  gsap.set(els, {
    autoAlpha: 0,
    y: 60,
    rotateX: -10,
    transformPerspective: 1200,
    transformOrigin: "50% 100%",
  });
  ScrollTrigger.batch(els, {
    start: "top 90%",
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, {
        autoAlpha: 1,
        y: 0,
        rotateX: 0,
        duration: 0.9,
        ease: "expo.out",
        stagger: 0.12,
      }),
  });
}

/** Cards that slide in from alternating sides. */
function sideCards(root: HTMLElement) {
  q(root, '[data-a="side-card"]').forEach((el, i) => {
    gsap.fromTo(
      el,
      { autoAlpha: 0, x: i % 2 ? 70 : -70 },
      {
        autoAlpha: 1,
        x: 0,
        duration: 1,
        ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      },
    );
    const rows = q(el, '[data-a="row"]');
    if (rows.length) {
      gsap.fromTo(
        rows,
        { autoAlpha: 0, x: -14 },
        {
          autoAlpha: 1,
          x: 0,
          duration: 0.5,
          ease: EASE,
          stagger: 0.06,
          scrollTrigger: { trigger: el, start: "top 80%", once: true },
        },
      );
    }
  });
}

/** "How it works": the line draws with the scroll, each step lights up at mid-screen. */
function solution(root: HTMLElement) {
  const flow = root.querySelector<HTMLElement>('[data-a="flow"]');
  if (!flow) return;
  const line = flow.querySelector<HTMLElement>('[data-a="flow-line"]');
  if (line) {
    gsap.fromTo(
      line,
      { scaleY: 0 },
      {
        scaleY: 1,
        ease: "none",
        transformOrigin: "top center",
        scrollTrigger: { trigger: flow, start: "top 65%", end: "bottom 55%", scrub: 0.6 },
      },
    );
  }
  for (const step of q(flow, '[data-a="flow-step"]')) {
    const dot = step.querySelector('[data-a="flow-dot"]');
    const body = step.querySelector('[data-a="flow-body"]');
    gsap.fromTo(
      body,
      { autoAlpha: 0, x: 50 },
      {
        autoAlpha: 1,
        x: 0,
        duration: 0.9,
        ease: "expo.out",
        scrollTrigger: { trigger: step, start: "top 85%", once: true },
      },
    );
    gsap.fromTo(
      dot,
      { scale: 0.4, autoAlpha: 0 },
      {
        scale: 1,
        autoAlpha: 1,
        duration: 0.6,
        ease: "back.out(2.4)",
        scrollTrigger: { trigger: step, start: "top 85%", once: true },
      },
    );
    ScrollTrigger.create({
      trigger: step,
      start: "top 58%",
      end: "bottom 42%",
      toggleClass: { targets: step, className: "is-active" },
    });
  }
}

/** Bento cards: reveal, then play their illustration. */
function bento(root: HTMLElement) {
  for (const card of q(root, '[data-a="bento"]')) {
    const tl = gsap.timeline({
      scrollTrigger: { trigger: card, start: "top 86%", once: true },
      defaults: { ease: EASE },
    });
    tl.fromTo(
      card,
      { autoAlpha: 0, y: 50, scale: 0.96 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.85, ease: "expo.out" },
    );
    const draws = q<SVGGeometryElement>(card, '[data-a="draw"]');
    if (draws.length) {
      for (const p of draws) {
        const len = typeof p.getTotalLength === "function" ? p.getTotalLength() : 200;
        gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
      }
      tl.to(
        draws,
        { strokeDashoffset: 0, duration: 0.9, stagger: 0.08, ease: "power2.inOut" },
        "-=0.35",
      );
    }
    const nodes = q(card, '[data-a="node"]');
    if (nodes.length) {
      tl.from(
        nodes,
        {
          scale: 0,
          transformOrigin: "50% 50%",
          duration: 0.5,
          stagger: 0.06,
          ease: "back.out(2.2)",
        },
        "-=0.6",
      );
    }
    const bars = q(card, '[data-a="bar"]');
    if (bars.length) {
      tl.from(
        bars,
        { scaleX: 0, transformOrigin: "0% 50%", duration: 0.7, stagger: 0.08, ease: "power3.out" },
        "-=0.4",
      );
    }
    const pops = q(card, '[data-a="pop"]');
    if (pops.length) {
      tl.from(
        pops,
        { autoAlpha: 0, y: 10, scale: 0.92, duration: 0.45, stagger: 0.08, ease: "back.out(1.8)" },
        "-=0.3",
      );
    }
  }
}

/** Gentle 3D tilt that follows the pointer. */
function tilt(root: HTMLElement) {
  const cleanups: (() => void)[] = [];
  for (const el of q(root, "[data-tilt]")) {
    gsap.set(el, { transformPerspective: 900 });
    const rx = gsap.quickTo(el, "rotateX", { duration: 0.5, ease: "power3.out" });
    const ry = gsap.quickTo(el, "rotateY", { duration: 0.5, ease: "power3.out" });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rx(-py * 6);
      ry(px * 8);
      el.style.setProperty("--mx", `${(px + 0.5) * 100}%`);
      el.style.setProperty("--my", `${(py + 0.5) * 100}%`);
    };
    const leave = () => {
      rx(0);
      ry(0);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    cleanups.push(() => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    });
  }
  return () => cleanups.forEach((c) => c());
}

/** Buttons that lean toward the pointer. */
function magnetic(root: HTMLElement) {
  const cleanups: (() => void)[] = [];
  for (const el of q(root, "[data-magnetic]")) {
    const x = gsap.quickTo(el, "x", { duration: 0.4, ease: "power3.out" });
    const y = gsap.quickTo(el, "y", { duration: 0.4, ease: "power3.out" });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      x((e.clientX - (r.left + r.width / 2)) * 0.25);
      y((e.clientY - (r.top + r.height / 2)) * 0.3);
    };
    const leave = () => {
      x(0);
      y(0);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    cleanups.push(() => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    });
  }
  return () => cleanups.forEach((c) => c());
}

function progressBar(root: HTMLElement) {
  const bar = root.querySelector<HTMLElement>('[data-a="progress"]');
  if (!bar) return;
  gsap.fromTo(
    bar,
    { scaleX: 0 },
    {
      scaleX: 1,
      ease: "none",
      transformOrigin: "0% 50%",
      scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
    },
  );
}

function closingCta(root: HTMLElement) {
  const el = root.querySelector<HTMLElement>('[data-a="cta"]');
  if (!el) return;
  gsap.fromTo(
    el,
    { scale: 0.86, autoAlpha: 0.4, borderRadius: "4rem" },
    {
      scale: 1,
      autoAlpha: 1,
      borderRadius: "2rem",
      ease: "none",
      scrollTrigger: { trigger: el, start: "top bottom", end: "center 60%", scrub: 0.6 },
    },
  );
  const glow = el.querySelector('[data-a="cta-glow"]');
  if (glow) gsap.to(glow, { rotate: 360, duration: 24, ease: "none", repeat: -1 });
}

/** Section links scroll smoothly, clearing the fixed header. */
function smoothAnchors(root: HTMLElement, reduce: boolean) {
  const click = (e: MouseEvent) => {
    const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href") ?? "";
    const target = id.length > 1 ? document.querySelector(id) : null;
    if (!target) return;
    e.preventDefault();
    gsap.to(window, {
      duration: reduce ? 0 : 1.1,
      ease: "power3.inOut",
      scrollTo: { y: target, offsetY: NAV_OFFSET - 1 },
    });
    history.replaceState(null, "", id);
  };
  root.addEventListener("click", click);
  return () => root.removeEventListener("click", click);
}

/** Run the page's choreography inside ``scope`` (the page root). */
export function useLandingMotion(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      const cleanups: (() => void)[] = [];

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        hero(root);
        parallax(root);
        marquee(root);
        headings(root);
        reveals(root);
        cards(root);
        sideCards(root);
        solution(root);
        bento(root);
        progressBar(root);
        closingCta(root);
        // Fonts settle layout after first paint; measure again once they have.
        document.fonts?.ready.then(() => ScrollTrigger.refresh());
      });
      mm.add("(prefers-reduced-motion: no-preference) and (pointer: fine)", () => {
        const a = tilt(root);
        const b = magnetic(root);
        return () => {
          a();
          b();
        };
      });
      mm.add("(prefers-reduced-motion: reduce)", () => {
        // The finished page, at once.
        gsap.set(q(root, '[data-a^="hero"]'), { autoAlpha: 1 });
      });

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      cleanups.push(smoothAnchors(root, reduce));
      // The hero is hidden by CSS until GSAP has taken over (no flash of the
      // finished state before the intro); hand control over now.
      root.classList.remove("landing-pending");

      return () => {
        cleanups.forEach((c) => c());
        mm.revert();
      };
    },
    { scope },
  );
}
