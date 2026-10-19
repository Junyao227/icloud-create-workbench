import { describe, expect, it } from 'vitest';

import { parseBuyerMailboxes } from '../public-mail-utils';

describe('parseBuyerMailboxes', () => {
  it('keeps a leading hyphen when the pickup code starts after four separator hyphens', () => {
    const rows = parseBuyerMailboxes(`62lipped.driest@icloud.com-----Aneleg7Dlep018x6-LX2iYZPROIdqGhj7cwLCS4Nbg`);

    expect(rows).toEqual([
      {
        email: '62lipped.driest@icloud.com',
        line: '62lipped.driest@icloud.com-----Aneleg7Dlep018x6-LX2iYZPROIdqGhj7cwLCS4Nbg',
        password: '-Aneleg7Dlep018x6-LX2iYZPROIdqGhj7cwLCS4Nbg'
      }
    ]);
  });

  it('keeps a leading hyphen when the separator wraps before the pickup code', () => {
    const rows = parseBuyerMailboxes(`62lipped.driest@icloud.com-----
Aneleg7Dlep018x6-LX2iYZPROIdqGhj7cwLCS4Nbg`);

    expect(rows[0]?.password).toBe('-Aneleg7Dlep018x6-LX2iYZPROIdqGhj7cwLCS4Nbg');
  });
});
