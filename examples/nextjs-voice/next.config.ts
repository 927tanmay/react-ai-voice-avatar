import type { NextConfig } from 'next';

// Nothing to configure: the package bundles its own workers. For multi-threaded
// inference, add the optional COOP/COEP headers described in the main README.
const nextConfig: NextConfig = {};

export default nextConfig;
