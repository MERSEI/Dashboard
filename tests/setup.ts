/**
 * Vitest setup. jest-dom only registers matchers on `expect`, so importing it
 * unconditionally is harmless for the node-environment suites.
 */
import '@testing-library/jest-dom'
