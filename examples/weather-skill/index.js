// WRAP NEBULA Skill — weather.check
// Check current weather for any location
// Uses wttr.in — no API key needed

const https = require('https');

module.exports = {
  name: 'weather.check',
  description: 'Check current weather for a location',
  category: 'web',
  permissions: ['network:https'],
  dangerous: false,
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or location (e.g., "Casablanca", "London, UK")'
      },
      format: {
        type: 'string',
        description: 'Output format: "brief" (one line) or "detailed"',
        enum: ['brief', 'detailed']
      }
    },
    required: ['location']
  },
  handler: async (params) => {
    const location = encodeURIComponent(params.location || 'Casablanca');
    const format = params.format || 'brief';

    return new Promise((resolve, reject) => {
      const url = `https://wttr.in/${location}?format=${format === 'brief' ? '%l:+%c+%t+%h+%w' : '%l:+%c+%C+%t+%f+%h+%w+%p+%P'}`;

      https.get(url, {
        headers: { 'User-Agent': 'WRAP-Nebula/8.0' },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk.toString());
        res.on('end', () => {
          resolve({
            success: true,
            output: data.trim()
          });
        });
      }).on('error', (err) => {
        resolve({
          success: false,
          output: null,
          error: `Weather lookup failed: ${err.message}`
        });
      });
    });
  }
};
