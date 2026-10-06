// Newsletter status labels shared by the list and the editor (page files
// may not export arbitrary names in the app router).
export const STATUS_LABEL = {
  draft: 'Draft', pending: 'Waiting for review', approved: 'Approved — scheduled', sending: 'Sending…', sent: 'Sent', failed: 'Send FAILED',
};
export const statusClass = (status) => `status-${status === 'sent' ? 'succeeded' : status}`;
