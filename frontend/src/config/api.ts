// API configuration - uses relative paths with Vite proxy in development
export const API_CONFIG = {
  ENDPOINTS: {
    CHAT: "/api/chat",
    ABORT: "/api/abort",
    PROJECTS: "/api/projects",
    HISTORIES: "/api/projects",
    CONVERSATIONS: "/api/projects",
    INTERACTIONS: "/api/interactions",
    RUNS: "/api/runs",
  },
} as const;

// Helper function to get full API URL
export const getApiUrl = (endpoint: string) => {
  return endpoint;
};

// Helper function to get abort URL
export const getAbortUrl = (requestId: string) => {
  return `${API_CONFIG.ENDPOINTS.ABORT}/${requestId}`;
};

// Helper function to get chat URL
export const getChatUrl = () => {
  return API_CONFIG.ENDPOINTS.CHAT;
};

export const getInteractionResponseUrl = (interactionId: string) => {
  return `${API_CONFIG.ENDPOINTS.INTERACTIONS}/${encodeURIComponent(interactionId)}/respond`;
};

export const getRunEventsUrl = (runId: string, after = 0) => {
  return `${API_CONFIG.ENDPOINTS.RUNS}/${encodeURIComponent(runId)}/events?after=${after}`;
};

export const getRunUrl = (runId: string) => {
  return `${API_CONFIG.ENDPOINTS.RUNS}/${encodeURIComponent(runId)}`;
};

export const getRunsUrl = () => {
  return API_CONFIG.ENDPOINTS.RUNS;
};

export const getSessionsUrl = (directory: string) => {
  return `/api/sessions?directory=${encodeURIComponent(directory)}`;
};

// Helper function to get projects URL
export const getProjectsUrl = () => {
  return API_CONFIG.ENDPOINTS.PROJECTS;
};

// Helper function to get histories URL
export const getHistoriesUrl = (projectPath: string) => {
  const encodedPath = encodeURIComponent(projectPath);
  return `${API_CONFIG.ENDPOINTS.HISTORIES}/${encodedPath}/histories`;
};

// Helper function to get conversation URL
export const getConversationUrl = (
  encodedProjectName: string,
  sessionId: string,
) => {
  return `${API_CONFIG.ENDPOINTS.CONVERSATIONS}/${encodedProjectName}/histories/${sessionId}`;
};
