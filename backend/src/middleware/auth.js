// Auth Middleware
// Platzhalter für JWT-Validierung

export const validateToken = async (request, reply) => {
  // TODO: JWT Token validieren
  // try {
  //   await request.jwtVerify()
  // } catch (err) {
  //   reply.code(401).send({ error: 'Unauthorized' })
  // }
};

export const optionalAuth = async (request, reply) => {
  // TODO: Optional auth - nicht erforderlich
};
