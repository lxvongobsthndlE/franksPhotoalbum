import { config } from 'dotenv';
config({ path: '.env.local' });

export default {
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
    provider: 'postgresql',
  },
};
