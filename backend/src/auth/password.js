import bcrypt from 'bcrypt';

// Password Hashing & Verification
// TODO: Bcrypt mit Fastify integrieren

export const hashPassword = async (password) => {
  return bcrypt.hash(password, 10);
};

export const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};
