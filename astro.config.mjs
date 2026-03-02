import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import awsAmplify from 'astro-aws-amplify';

export default defineConfig({
  output: "server",
  adapter: awsAmplify(),
});
