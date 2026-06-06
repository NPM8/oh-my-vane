'use client';

import { KeyRound } from 'lucide-react';
import PasswordSection from '../Account/PasswordSection';

const ForcePasswordChange = () => (
  <div className="bg-light-primary dark:bg-dark-primary h-screen w-screen fixed inset-0 flex items-center justify-center px-4">
    <div className="w-full max-w-sm bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 rounded-xl shadow-sm p-6 flex flex-col space-y-5">
      <div className="flex flex-col items-center text-center space-y-2">
        <KeyRound className="w-8 h-8 text-[#24A0ED]" />
        <h1 className="text-lg font-medium text-black dark:text-white">Set a new password</h1>
        <p className="text-xs text-black/50 dark:text-white/50">Your password was reset by an administrator. Choose a new one to continue.</p>
      </div>
      <PasswordSection forced />
    </div>
  </div>
);

export default ForcePasswordChange;
