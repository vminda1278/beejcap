// Helper functions for the application

/**
 * Extract domain from an email address
 * @param {string} email - Email address
 * @returns {string} Domain part of the email
 */
function extractDomain(email) {
  if (!email || typeof email !== 'string') {
      throw new Error('Invalid email address');
  }
  const domain = email.split('@')[1];
  if (!domain) {
      throw new Error('Invalid email address');
  }
  return domain;
}

/**
 * Convert array of attributes from Cognito to an object
 * @param {Array} attributes - Array of attribute objects with Name and Value properties
 * @returns {Object} Object with keys from Name and values from Value
 */
function convertAttributesArray(attributes) {
  if (!Array.isArray(attributes)) {
    return {};
  }
  
  return attributes.reduce((obj, attr) => {
    if (attr.Name && attr.Value !== undefined) {
      obj[attr.Name] = attr.Value;
    }
    return obj;
  }, {});
}

/**
 * Get the start of day timestamp in UTC
 * @param {Date} date - Date object
 * @returns {number} Timestamp in milliseconds
 */
const getStartOfDayUTC = (date) => {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start.getTime();
};

/**
 * Get the end of day timestamp in UTC
 * @param {Date} date - Date object
 * @returns {number} Timestamp in milliseconds
 */
const getEndOfDayUTC = (date) => {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end.getTime();
};

/**
 * Convert UTC time to local time
 * @param {string|Date} utcDate - UTC date string or Date object
 * @returns {number} Local timestamp in milliseconds
 */
const convertUTCToLocalTime = (utcDate) => {
  const localDate = new Date(utcDate);
  return localDate.getTime();
};

/**
 * Generate a unique application ID
 * @returns {string} Unique ID
 */
function generateUniqueId() {
  const timestamp = Date.now().toString(36); // Convert timestamp to base-36 string
  const randomString = Math.random().toString(36).substring(2, 8); // Generate a random base-36 string
  return `${timestamp}-${randomString}`;
}

/**
 * Format a string to camelCase with capitalized first letter (PascalCase)
 * @param {string} inputString - Input string to format
 * @returns {string} Formatted string
 */
function formatKeyName(inputString) {
  const formattedString = inputString
    .toLowerCase()
    .replace(/[-]/g, ' ') // Replace hyphens with spaces
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove non-alphanumeric characters except spaces
    .split(/\s+/) // Split the string by spaces
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
    .join(''); // Join the words without spaces
  return formattedString;
}

/**
 * Convert a PascalCase string back to a spaced uppercase string
 * @param {string} formattedString - PascalCase string
 * @returns {string} Uppercase string with spaces
 */
function reverseFormatKeyName(formattedString) {
  const reversedString = formattedString
    .replace(/([A-Z])/g, ' $1') // Insert space before each uppercase letter
    .trim() // Remove leading space
    .toUpperCase(); // Convert to uppercase
  return reversedString;
}

module.exports = {
  extractDomain,
  convertAttributesArray,
  getStartOfDayUTC,
  getEndOfDayUTC,
  convertUTCToLocalTime,
  generateUniqueId,
  formatKeyName,
  reverseFormatKeyName
};
