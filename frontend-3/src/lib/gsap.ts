/**
 * GSAP for the whole app: plugin registration and the two pieces of motion
 * the working screens use. They are deliberately small — a page settling in,
 * cards arriving in order — because people use these screens to get work
 * done, not to watch them. The landing page has its own, larger choreography
 * (components/landing/motion.ts).
 *
 * Everything respects "reduce motion" and runs only in the browser.
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

export { gsap, ScrollToPlugin, ScrollTrigger, SplitText, useGSAP };

export function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** At most this many cards are staggered in on a page; the rest just appear. */
const MAX_STAGGERED = 14;

/**
 * A page settling in after navigation: the page lifts into place and its
 * panels arrive in reading order. Quick (≈0.4 s) and only on a route change,
 * never on data refreshes.
 */
export function usePageTransition(ref: RefObject<HTMLElement | null>, routeKey: string) {
  useGSAP(
    () => {
      const el = ref.current;
      if (!el || reducedMotion()) return;
      gsap.fromTo(
        el,
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: 0.38, ease: "power2.out", clearProps: "transform" },
      );
      const cards = Array.from(el.querySelectorAll<HTMLElement>(".glass, [data-enter]")).slice(
        0,
        MAX_STAGGERED,
      );
      if (cards.length) {
        gsap.fromTo(
          cards,
          { autoAlpha: 0, y: 14 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.45,
            ease: "power3.out",
            stagger: 0.035,
            delay: 0.05,
            clearProps: "transform,opacity,visibility",
          },
        );
      }
    },
    { dependencies: [routeKey], scope: ref },
  );
}

/**
 * The sign-in screens: the brand panel's headline reveals word by word, its
 * points follow, the form rises in, and the background glow drifts slowly.
 */
export function useAuthIntro(ref: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      root.classList.remove("auth-pending");
      if (reducedMotion()) return;
      const q = (s: string) => Array.from(root.querySelectorAll<HTMLElement>(s));
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      const title = root.querySelector<HTMLElement>("[data-auth='title']");
      if (title) {
        SplitText.create(title, {
          type: "words",
          mask: "words",
          wordsClass: "split-word",
          autoSplit: true,
          onSplit(self) {
            return gsap.from(self.words, {
              yPercent: 110,
              opacity: 0,
              duration: 0.9,
              ease: "expo.out",
              stagger: 0.05,
              delay: 0.15,
            });
          },
        });
      }
      const points = q("[data-auth='point']");
      if (points.length) {
        tl.from(points, { autoAlpha: 0, x: -24, duration: 0.6, stagger: 0.1 }, 0.5);
      }
      const form = q("[data-auth='form']");
      if (form.length) {
        tl.from(form, { autoAlpha: 0, y: 24, scale: 0.98, duration: 0.7, ease: "expo.out" }, 0.1);
        const fields = q("[data-auth='form'] form > *");
        if (fields.length) {
          tl.from(fields, { autoAlpha: 0, y: 10, duration: 0.4, stagger: 0.05 }, 0.3);
        }
      }
      for (const glow of q("[data-auth='glow']")) {
        gsap.to(glow, {
          x: "random(-60, 60)",
          y: "random(-40, 40)",
          scale: "random(0.9, 1.15)",
          duration: 8,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          repeatRefresh: true,
        });
      }
    },
    { scope: ref },
  );
}
