import { buildExtendedPack, extraCommonEn } from '../../i18n/extra';

const pack = buildExtendedPack('en');

/** Shared `useLang` mock for Store Chat panel tests (English + storeChat keys). */
export function mockUseLang(overrides?: { lang?: string; isRtl?: boolean }) {
  return {
    lang: overrides?.lang ?? 'en',
    isRtl: overrides?.isRtl ?? false,
    setLang: () => {},
    t: {
      common: {
        save: 'Save',
        cancel: 'Cancel',
        edit: 'Edit',
        delete: 'Delete',
        approve: 'Approve',
        reject: 'Reject',
        saving: 'Saving…',
        loading: 'Loading…',
        active: 'Active',
        inactive: 'Inactive',
        search: 'Search',
        add: 'Add',
        create: 'Create',
        update: 'Update',
        close: 'Close',
        yes: 'Yes',
        no: 'No',
        back: 'Back',
        next: 'Next',
        submit: 'Submit',
        send: 'Send',
        copy: 'Copy',
        copied: 'Copied!',
        revoke: 'Revoke',
        noData: 'No data.',
        actions: 'Actions',
        status: 'Status',
        role: 'Role',
        stores: 'Stores',
        name: 'Name',
        code: 'Code',
        address: 'Address',
        area: 'Area',
        date: 'Date',
        note: 'Note',
        type: 'Type',
        ...extraCommonEn,
      },
      storeChat: pack.storeChat,
      floatingAssistant: pack.floatingAssistant,
    },
  };
}
