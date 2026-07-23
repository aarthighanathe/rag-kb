/**
 * @file security.ts
 * @description Security middleware — Helmet headers, CORS, and HTTP method restrictions
 *
 * Threat model:
 *  - Helmet/CSP        → XSS (A03), clickjacking (A05), MIME sniffing (A05)
 *  - HSTS              → SSL-stripping / downgrade attacks (A02)
 *  - CORS allowlist    → cross-origin data exfiltration (A01)
 *  - credentials:false → cookie-based CSRF (A01) — this API is stateless
 *  - Referrer-Policy   → information leakage via Referer header (A02)
 *
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { type Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { CORRELATION_ID_HEADER } from './correlationId.js';

/**
 * Applies all security middleware to the Express application.
 * Must be called before routes are mounted.
 * @param app - Express application instance
 */
export function securityMiddleware(app: Application): void {
  // ── Helmet — security response headers ──────────────────────────────────────
  // Threat: A05 Security Misconfiguration — missing security headers allow
  // browser-based attacks (XSS, clickjacking, MIME confusion, protocol downgrade).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Block all resources unless explicitly listed → strict allow-list model
          defaultSrc: ["'self'"],
          // Scripts: same-origin only. No eval, no inline, no CDN.
          scriptSrc: ["'self'"],
          // Styles: unsafe-inline required for Swagger UI injected <style> tags.
          styleSrc: ["'self'", "'unsafe-inline'"],
          // Images: data: URIs used by Swagger UI for icons.
          imgSrc: ["'self'", 'data:'],
          // XHR / fetch / WebSocket: same-origin only (no external API calls from browser).
          connectSrc: ["'self'"],
          // Fonts: same-origin only.
          fontSrc: ["'self'"],
          // Disallow all <object>, <embed>, <applet> — vectors for plugin exploits.
          objectSrc: ["'none'"],
          // Disallow all media — reduces attack surface, this API serves no media.
          mediaSrc: ["'none'"],
          // Disallow all <frame>, <iframe>, <embed> — prevents clickjacking.
          frameSrc: ["'none'"],
        },
      },
      // COEP/COOP/CORP: process isolation — mitigates Spectre-class side-channels.
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      // HSTS: forces HTTPS for 1 year on this domain and all subdomains.
      // Threat: A02 — prevents SSL-stripping attacks on first request after the header is cached.
      hsts: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true,
        preload: true,
      },
      // Prevents MIME-type sniffing — browsers must respect Content-Type header.
      // Threat: A03 — stops polyglot file attacks where a file valid as two types.
      noSniff: true,
      // Limits Referer header to same-origin only.
      // Threat: A02 — prevents leaking internal path structure to third-party origins.
      referrerPolicy: { policy: 'same-origin' },
    }),
  );

  // ── CORS — cross-origin request allowlist ────────────────────────────────────
  // Threat: A01 Broken Access Control — without CORS restriction, any origin can
  // make credentialed requests that read API responses in the browser.
  app.use(
    // Delegate form (req, callback) rather than the static (origin, callback)
    // form — this CORS check runs before correlationIdMiddleware (Rule 14
    // requires every log entry to include a correlationId, including this
    // rejection), and only the delegate form's `req` gives access to the
    // client's X-Correlation-ID header. Mirrors correlationIdMiddleware's own
    // precedence: reuse a client-supplied ID if present, else mint a UUID.
    cors((req, callback) => {
      const rawId = req.headers[CORRELATION_ID_HEADER.toLowerCase()];
      const correlationId = typeof rawId === 'string' && rawId.length <= 128 ? rawId.slice(0, 128) : uuidv4();
      const origin = req.headers.origin;

      // Allow server-to-server requests (no Origin header) and the configured origin.
      // In non-production, also allow VS Code devtunnel origins (random per-session
      // subdomain) so the app works both on localhost and through a forwarded tunnel
      // without editing CORS_ORIGIN every time a new tunnel is created.
      const isDevTunnel = env.NODE_ENV !== 'production' && /^https:\/\/[^/]+\.devtunnels\.ms$/.test(origin ?? '');
      if (!origin || origin === env.CORS_ORIGIN || isDevTunnel) {
        callback(null, {
          // Echo back the actual request origin (not '*') — matches the
          // prior static-origin-callback behavior of `callback(null, true)`.
          origin: true,
          methods: ['GET', 'POST', 'DELETE'],
          allowedHeaders: ['Content-Type', 'X-Correlation-ID', 'X-Admin-Secret', 'Authorization'],
          exposedHeaders: ['X-Correlation-ID', 'X-RateLimit-Remaining'],
          credentials: false,
          maxAge: 86400,
        });
      } else {
        logger.warn('CORS rejection', { origin, correlationId });
        callback(new Error(`CORS policy: origin ${origin} is not allowed`));
      }
    }),
  );

  // Remove X-Powered-By: Express fingerprint.
  // Threat: A05 — version fingerprinting aids targeted vulnerability scanning.
  app.disable('x-powered-by');
}
