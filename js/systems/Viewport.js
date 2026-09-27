// Decides the virtual resolution and device class ONCE, at boot.
//
// After detect() runs, these values are FROZEN for the lifetime of
// the page load. Resizing the window or rotating a phone does not
// change them. The Renderer re-fits the frozen virtual box into
// whatever real box it is given, letterboxing the difference.
//
// Two virtual resolutions:
//   desktop: 1280 x 720  (landscape)
//   mobile:   720 x 1280 (portrait)
//
// They share a pixel budget and aspect ratio (16:9), just rotated.
//
// Detection is size + touch based, NOT user-agent based.

export const DESKTOP_WIDTH  = 1280;
export const DESKTOP_HEIGHT = 720;
export const MOBILE_WIDTH   = 720;
export const MOBILE_HEIGHT  = 1280;

const MOBILE_MAX_MIN_SIDE = 900;

export const Viewport = {
  width:    DESKTOP_WIDTH,
  height:   DESKTOP_HEIGHT,
  isMobile: false,

  detect() {
    const minSide = Math.min(window.innerWidth, window.innerHeight);
    const hasTouch = ("ontouchstart" in window)
      || (navigator.maxTouchPoints > 0)
      || (navigator.msMaxTouchPoints > 0);

    this.isMobile = hasTouch && minSide < MOBILE_MAX_MIN_SIDE;

    if (this.isMobile) {
      this.width  = MOBILE_WIDTH;
      this.height = MOBILE_HEIGHT;
    } else {
      this.width  = DESKTOP_WIDTH;
      this.height = DESKTOP_HEIGHT;
    }
  },
};