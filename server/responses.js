export function successResponse(data) {
  return {
    ok: true,
    data,
    error: null
  };
}

export function errorResponse(message, details = {}) {
  return {
    ok: false,
    data: null,
    error: {
      message,
      ...details
    }
  };
}

export function toolTextPayload(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload)
      }
    ]
  };
}
