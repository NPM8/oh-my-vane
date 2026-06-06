'use client';

import AccountView from '../Account/AccountView';

const Force2FA = () => (
  <div className="bg-light-primary dark:bg-dark-primary min-h-screen w-screen fixed inset-0 overflow-y-auto">
    <AccountView forceEnroll />
  </div>
);

export default Force2FA;
