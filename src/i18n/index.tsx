import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { deepMerge } from './fallback';
import { buildExtendedPack, extraCommonEn, type ExtendedSections } from './extra';

// ─── Supported languages ──────────────────────────────────────────────────────

export type LangCode =
  | 'en' | 'vi'                          // primary buttons
  | 'fr' | 'zh' | 'es' | 'ar'           // others dropdown
  | 'pt' | 'ru' | 'ja' | 'de' | 'hi' | 'id';

export interface LangMeta {
  code: LangCode;
  label: string;   // native name
  english: string; // English name
  rtl?: boolean;
  flag: string;
}

export const LANGUAGES: LangMeta[] = [
  { code: 'en', label: 'English',    english: 'English',    flag: '🇬🇧' },
  { code: 'vi', label: 'Tiếng Việt', english: 'Vietnamese', flag: '🇻🇳' },
  { code: 'fr', label: 'Français',   english: 'French',     flag: '🇫🇷' },
  { code: 'zh', label: '中文',        english: 'Chinese',    flag: '🇨🇳' },
  { code: 'es', label: 'Español',    english: 'Spanish',    flag: '🇪🇸' },
  { code: 'ar', label: 'العربية',    english: 'Arabic',     flag: '🇸🇦', rtl: true },
  { code: 'pt', label: 'Português',  english: 'Portuguese', flag: '🇧🇷' },
  { code: 'ru', label: 'Русский',    english: 'Russian',    flag: '🇷🇺' },
  { code: 'ja', label: '日本語',      english: 'Japanese',   flag: '🇯🇵' },
  { code: 'de', label: 'Deutsch',    english: 'German',     flag: '🇩🇪' },
  { code: 'hi', label: 'हिन्दी',      english: 'Hindi',      flag: '🇮🇳' },
  { code: 'id', label: 'Bahasa',     english: 'Indonesian', flag: '🇮🇩' },
];

// ─── Translation shape ────────────────────────────────────────────────────────

export type T = {
  nav: {
    dashboard: string; submit: string; review: string; profile: string;
    stores: string; users: string; templates: string; corrective: string;
    photos: string; verify: string; shifts: string; logbook: string; signOut: string;
  };
  auth: {
    subtitle: string; signIn: string; emailLabel: string; emailPlaceholder: string;
    sendCode: string; sending: string; checkEmail: string; codeSentTo: string;
    codeLabel: string; verifying: string; signInBtn: string; useDifferent: string;
    pendingTitle: string; pendingBody: string; pendingNote: string; waitingBadge: string;
    pendingManagerReviewBody: string; pendingPreApprovedBody: string; pendingNeedsRecheckBody: string;
    rejectedTitle: string; rejectedBody: string; rejectedContact: string; signOut: string;
    sendingCode: string; signingIn: string; settingUp: string;
    errorTitle: string; settingUpAccount: string;
  };
  common: {
    save: string; cancel: string; edit: string; delete: string; approve: string;
    reject: string; saving: string; loading: string; active: string; inactive: string;
    search: string; add: string; create: string; update: string; close: string;
    yes: string; no: string; back: string; next: string; submit: string; send: string;
    copy: string; copied: string; revoke: string; noData: string; actions: string;
    status: string; role: string; stores: string; name: string; code: string;
    address: string; area: string; date: string; note: string; type: string;
  } & typeof extraCommonEn;
  pages: {
    dashboard: string; submit: string; review: string; stores: string; users: string;
    templates: string; corrective: string; photos: string; verify: string;
    shifts: string; logbook: string; profile: string;
  };
  lang: { label: string; others: string; };
} & ExtendedSections;

// ─── Translations ─────────────────────────────────────────────────────────────

const translations: Record<LangCode, T> = {
  en: {
    nav: {
      dashboard: 'Dashboard', submit: 'Submit', review: 'Review', profile: 'Profile',
      stores: 'Stores', users: 'Users', templates: 'Templates', corrective: 'Corrective',
      photos: 'Photo Sheet', verify: 'Verify Photo', shifts: 'Shifts', logbook: 'Logbook',
      signOut: 'Sign out',
    },
    auth: {
      subtitle: 'Restaurant operations platform',
      signIn: 'Sign in', emailLabel: 'Email address', emailPlaceholder: 'you@example.com',
      sendCode: 'Send sign-in code →', sending: 'Sending…', checkEmail: 'Check your email',
      codeSentTo: 'We sent a 6-digit code to', codeLabel: '6-digit code',
      verifying: 'Verifying…', signInBtn: 'Sign in', useDifferent: '← Use a different email',
      pendingTitle: 'Access Pending', pendingBody: 'Your account is waiting for approval by an owner or area manager.',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval from an owner or area manager.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: 'This screen updates automatically — no need to refresh.',
      waitingBadge: 'Waiting for approval',
      rejectedTitle: 'Access Denied', rejectedBody: 'The request was not approved.',
      rejectedContact: 'Contact the owner or area manager for assistance.',
      signOut: 'Sign out', sendingCode: 'Sending your code…', signingIn: 'Signing you in…',
      settingUp: 'Setting up your account…',
    },
    common: {
      save: 'Save', cancel: 'Cancel', edit: 'Edit', delete: 'Delete', approve: 'Approve',
      reject: 'Reject', saving: 'Saving…', loading: 'Loading…', active: 'Active',
      inactive: 'Inactive', search: 'Search', add: 'Add', create: 'Create', update: 'Update',
      close: 'Close', yes: 'Yes', no: 'No', back: 'Back', next: 'Next', submit: 'Submit',
      send: 'Send', copy: 'Copy', copied: 'Copied!', revoke: 'Revoke', noData: 'No data yet.',
      actions: 'Actions', status: 'Status', role: 'Role', stores: 'Stores', name: 'Name',
      code: 'Code', address: 'Address', area: 'Area', date: 'Date', note: 'Note',
      type: 'Type',
    },
    pages: {
      dashboard: 'Operation Dashboard', submit: 'Submit Report', review: 'Review Reports',
      stores: 'Stores', users: 'Users & Access', templates: 'Templates',
      corrective: 'Corrective Actions', photos: 'Photo Sheet', verify: 'Photo Verification',
      shifts: 'Shifts', logbook: 'Logbook', profile: 'Profile',
    },
    lang: { label: 'Language', others: 'Others' },
  },

  vi: {
    nav: {
      dashboard: 'Bảng điều khiển', submit: 'Nộp báo cáo', review: 'Xem xét',
      profile: 'Hồ sơ', stores: 'Cửa hàng', users: 'Người dùng', templates: 'Mẫu báo cáo',
      corrective: 'Khắc phục', photos: 'Bảng ảnh', verify: 'Xác minh ảnh',
      shifts: 'Ca làm việc', logbook: 'Nhật ký', signOut: 'Đăng xuất',
    },
    auth: {
      subtitle: 'Nền tảng quản lý vận hành nhà hàng',
      signIn: 'Đăng nhập', emailLabel: 'Địa chỉ email', emailPlaceholder: 'ban@example.com',
      sendCode: 'Gửi mã đăng nhập →', sending: 'Đang gửi…', checkEmail: 'Kiểm tra email của bạn',
      codeSentTo: 'Chúng tôi đã gửi mã 6 chữ số đến', codeLabel: 'Mã 6 chữ số',
      verifying: 'Đang xác minh…', signInBtn: 'Đăng nhập', useDifferent: '← Dùng email khác',
      pendingTitle: 'Chờ phê duyệt',
      pendingBody: 'Tài khoản của bạn đang chờ được phê duyệt bởi chủ sở hữu hoặc quản lý khu vực.',
      pendingManagerReviewBody: 'Yêu cầu của bạn đang được quản lý cửa hàng xác minh và phê duyệt sơ bộ.',
      pendingPreApprovedBody: 'Quản lý cửa hàng đã phê duyệt sơ bộ. Đang chờ phê duyệt cuối từ chủ sở hữu hoặc quản lý khu vực.',
      pendingNeedsRecheckBody: 'Yêu cầu của bạn cần quản lý cửa hàng kiểm tra lại trước khi phê duyệt cuối.',
      pendingNote: 'Màn hình này tự động cập nhật — không cần tải lại.',
      waitingBadge: 'Đang chờ phê duyệt',
      rejectedTitle: 'Truy cập bị từ chối', rejectedBody: 'Yêu cầu của bạn không được phê duyệt.',
      rejectedContact: 'Liên hệ chủ sở hữu hoặc quản lý khu vực để được hỗ trợ.',
      signOut: 'Đăng xuất', sendingCode: 'Đang gửi mã…', signingIn: 'Đang đăng nhập…',
      settingUp: 'Đang thiết lập tài khoản…',
    },
    common: {
      save: 'Lưu', cancel: 'Hủy', edit: 'Sửa', delete: 'Xóa', approve: 'Phê duyệt',
      reject: 'Từ chối', saving: 'Đang lưu…', loading: 'Đang tải…', active: 'Hoạt động',
      inactive: 'Không hoạt động', search: 'Tìm kiếm', add: 'Thêm', create: 'Tạo mới',
      update: 'Cập nhật', close: 'Đóng', yes: 'Có', no: 'Không', back: 'Quay lại',
      next: 'Tiếp theo', submit: 'Nộp', send: 'Gửi', copy: 'Sao chép', copied: 'Đã sao chép!',
      revoke: 'Thu hồi', noData: 'Chưa có dữ liệu.', actions: 'Hành động', status: 'Trạng thái',
      role: 'Vai trò', stores: 'Cửa hàng', name: 'Tên', code: 'Mã', address: 'Địa chỉ',
      area: 'Khu vực', date: 'Ngày', note: 'Ghi chú', type: 'Loại',
    },
    pages: {
      dashboard: 'Bảng điều khiển vận hành', submit: 'Nộp báo cáo', review: 'Xem xét báo cáo',
      stores: 'Cửa hàng', users: 'Người dùng & Quyền truy cập', templates: 'Mẫu báo cáo',
      corrective: 'Hành động khắc phục', photos: 'Bảng ảnh', verify: 'Xác minh ảnh',
      shifts: 'Ca làm việc', logbook: 'Nhật ký ca', profile: 'Hồ sơ cá nhân',
    },
    lang: { label: 'Ngôn ngữ', others: 'Khác' },
  },

  fr: {
    nav: {
      dashboard: 'Tableau de bord', submit: 'Soumettre', review: 'Réviser', profile: 'Profil',
      stores: 'Magasins', users: 'Utilisateurs', templates: 'Modèles', corrective: 'Correctif',
      photos: 'Galerie photos', verify: 'Vérifier photo', shifts: 'Quarts', logbook: 'Journal',
      signOut: 'Déconnexion',
    },
    auth: {
      subtitle: 'Plateforme de gestion de restaurant',
      signIn: 'Connexion', emailLabel: 'Adresse e-mail', emailPlaceholder: 'vous@exemple.com',
      sendCode: 'Envoyer le code →', sending: 'Envoi…', checkEmail: 'Vérifiez votre e-mail',
      codeSentTo: 'Nous avons envoyé un code à 6 chiffres à', codeLabel: 'Code à 6 chiffres',
      verifying: 'Vérification…', signInBtn: 'Se connecter', useDifferent: '← Autre e-mail',
      pendingTitle: 'Accès en attente', pendingBody: 'Votre compte attend approbation.',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: 'Cet écran se met à jour automatiquement.',
      waitingBadge: "En attente d'approbation",
      rejectedTitle: 'Accès refusé', rejectedBody: "La demande n'a pas été approuvée.",
      rejectedContact: 'Contactez le responsable pour obtenir de l\'aide.',
      signOut: 'Déconnexion', sendingCode: 'Envoi du code…', signingIn: 'Connexion…',
      settingUp: 'Configuration du compte…',
    },
    common: {
      save: 'Enregistrer', cancel: 'Annuler', edit: 'Modifier', delete: 'Supprimer',
      approve: 'Approuver', reject: 'Rejeter', saving: 'Enregistrement…', loading: 'Chargement…',
      active: 'Actif', inactive: 'Inactif', search: 'Rechercher', add: 'Ajouter',
      create: 'Créer', update: 'Mettre à jour', close: 'Fermer', yes: 'Oui', no: 'Non',
      back: 'Retour', next: 'Suivant', submit: 'Soumettre', send: 'Envoyer',
      copy: 'Copier', copied: 'Copié!', revoke: 'Révoquer', noData: 'Pas de données.',
      actions: 'Actions', status: 'Statut', role: 'Rôle', stores: 'Magasins', name: 'Nom',
      code: 'Code', address: 'Adresse', area: 'Zone', date: 'Date', note: 'Note', type: 'Type',
    },
    pages: {
      dashboard: 'Tableau de bord', submit: 'Soumettre rapport', review: 'Réviser rapports',
      stores: 'Magasins', users: 'Utilisateurs & Accès', templates: 'Modèles',
      corrective: 'Actions correctives', photos: 'Galerie photos', verify: 'Vérification photo',
      shifts: 'Quarts de travail', logbook: 'Journal de bord', profile: 'Profil',
    },
    lang: { label: 'Langue', others: 'Autres' },
  },

  zh: {
    nav: {
      dashboard: '仪表板', submit: '提交', review: '审核', profile: '个人资料',
      stores: '门店', users: '用户', templates: '模板', corrective: '纠正措施',
      photos: '照片表', verify: '验证照片', shifts: '班次', logbook: '日志', signOut: '退出',
    },
    auth: {
      subtitle: '餐厅运营管理平台',
      signIn: '登录', emailLabel: '电子邮件地址', emailPlaceholder: 'you@example.com',
      sendCode: '发送登录验证码 →', sending: '发送中…', checkEmail: '查看您的邮箱',
      codeSentTo: '我们已向以下地址发送了6位验证码', codeLabel: '6位验证码',
      verifying: '验证中…', signInBtn: '登录', useDifferent: '← 使用其他邮箱',
      pendingTitle: '等待审批', pendingBody: '您的账户正在等待所有者或区域经理的审批。',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: '屏幕将自动更新，无需刷新。',
      waitingBadge: '等待审批',
      rejectedTitle: '访问被拒绝', rejectedBody: '您的请求未被批准。',
      rejectedContact: '请联系所有者或区域经理寻求帮助。',
      signOut: '退出', sendingCode: '发送验证码…', signingIn: '登录中…',
      settingUp: '设置账户中…',
    },
    common: {
      save: '保存', cancel: '取消', edit: '编辑', delete: '删除', approve: '批准',
      reject: '拒绝', saving: '保存中…', loading: '加载中…', active: '活跃',
      inactive: '停用', search: '搜索', add: '添加', create: '创建', update: '更新',
      close: '关闭', yes: '是', no: '否', back: '返回', next: '下一步', submit: '提交',
      send: '发送', copy: '复制', copied: '已复制!', revoke: '撤销', noData: '暂无数据。',
      actions: '操作', status: '状态', role: '角色', stores: '门店', name: '名称',
      code: '代码', address: '地址', area: '区域', date: '日期', note: '备注', type: '类型',
    },
    pages: {
      dashboard: '运营仪表板', submit: '提交报告', review: '审核报告',
      stores: '门店管理', users: '用户与权限', templates: '报告模板',
      corrective: '纠正措施', photos: '照片表', verify: '照片验证',
      shifts: '班次管理', logbook: '值班日志', profile: '个人资料',
    },
    lang: { label: '语言', others: '其他' },
  },

  es: {
    nav: {
      dashboard: 'Panel', submit: 'Enviar', review: 'Revisar', profile: 'Perfil',
      stores: 'Tiendas', users: 'Usuarios', templates: 'Plantillas', corrective: 'Correctivo',
      photos: 'Fotos', verify: 'Verificar foto', shifts: 'Turnos', logbook: 'Bitácora',
      signOut: 'Cerrar sesión',
    },
    auth: {
      subtitle: 'Plataforma de operaciones de restaurante',
      signIn: 'Iniciar sesión', emailLabel: 'Correo electrónico',
      emailPlaceholder: 'usted@ejemplo.com',
      sendCode: 'Enviar código →', sending: 'Enviando…', checkEmail: 'Revise su correo',
      codeSentTo: 'Enviamos un código de 6 dígitos a', codeLabel: 'Código de 6 dígitos',
      verifying: 'Verificando…', signInBtn: 'Iniciar sesión', useDifferent: '← Otro correo',
      pendingTitle: 'Acceso pendiente', pendingBody: 'Su cuenta espera aprobación.',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: 'Esta pantalla se actualiza automáticamente.',
      waitingBadge: 'Esperando aprobación',
      rejectedTitle: 'Acceso denegado', rejectedBody: 'La solicitud no fue aprobada.',
      rejectedContact: 'Contacte al propietario o gerente de área.',
      signOut: 'Cerrar sesión', sendingCode: 'Enviando código…', signingIn: 'Iniciando sesión…',
      settingUp: 'Configurando cuenta…',
    },
    common: {
      save: 'Guardar', cancel: 'Cancelar', edit: 'Editar', delete: 'Eliminar',
      approve: 'Aprobar', reject: 'Rechazar', saving: 'Guardando…', loading: 'Cargando…',
      active: 'Activo', inactive: 'Inactivo', search: 'Buscar', add: 'Agregar',
      create: 'Crear', update: 'Actualizar', close: 'Cerrar', yes: 'Sí', no: 'No',
      back: 'Atrás', next: 'Siguiente', submit: 'Enviar', send: 'Enviar',
      copy: 'Copiar', copied: '¡Copiado!', revoke: 'Revocar', noData: 'Sin datos.',
      actions: 'Acciones', status: 'Estado', role: 'Rol', stores: 'Tiendas', name: 'Nombre',
      code: 'Código', address: 'Dirección', area: 'Área', date: 'Fecha', note: 'Nota',
      type: 'Tipo',
    },
    pages: {
      dashboard: 'Panel de operaciones', submit: 'Enviar informe', review: 'Revisar informes',
      stores: 'Tiendas', users: 'Usuarios y acceso', templates: 'Plantillas',
      corrective: 'Acciones correctivas', photos: 'Hoja de fotos', verify: 'Verificar foto',
      shifts: 'Turnos', logbook: 'Bitácora', profile: 'Perfil',
    },
    lang: { label: 'Idioma', others: 'Otros' },
  },

  ar: {
    nav: {
      dashboard: 'لوحة التحكم', submit: 'إرسال', review: 'مراجعة', profile: 'الملف الشخصي',
      stores: 'المتاجر', users: 'المستخدمون', templates: 'القوالب', corrective: 'الإجراءات التصحيحية',
      photos: 'صفحة الصور', verify: 'التحقق من الصورة', shifts: 'الورديات', logbook: 'السجل',
      signOut: 'تسجيل الخروج',
    },
    auth: {
      subtitle: 'منصة إدارة عمليات المطاعم',
      signIn: 'تسجيل الدخول', emailLabel: 'البريد الإلكتروني',
      emailPlaceholder: 'you@example.com',
      sendCode: 'إرسال رمز الدخول ←', sending: 'جارٍ الإرسال…', checkEmail: 'تحقق من بريدك',
      codeSentTo: 'أرسلنا رمزاً مكوناً من 6 أرقام إلى', codeLabel: 'رمز من 6 أرقام',
      verifying: 'جارٍ التحقق…', signInBtn: 'تسجيل الدخول', useDifferent: 'استخدام بريد آخر →',
      pendingTitle: 'الوصول معلق', pendingBody: 'حسابك في انتظار الموافقة.',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: 'تتحدث الشاشة تلقائياً.',
      waitingBadge: 'في انتظار الموافقة',
      rejectedTitle: 'تم رفض الوصول', rejectedBody: 'لم تتم الموافقة على طلبك.',
      rejectedContact: 'اتصل بالمالك أو مدير المنطقة للمساعدة.',
      signOut: 'تسجيل الخروج', sendingCode: 'إرسال الرمز…', signingIn: 'تسجيل الدخول…',
      settingUp: 'إعداد الحساب…',
    },
    common: {
      save: 'حفظ', cancel: 'إلغاء', edit: 'تعديل', delete: 'حذف', approve: 'موافقة',
      reject: 'رفض', saving: 'جارٍ الحفظ…', loading: 'جارٍ التحميل…', active: 'نشط',
      inactive: 'غير نشط', search: 'بحث', add: 'إضافة', create: 'إنشاء', update: 'تحديث',
      close: 'إغلاق', yes: 'نعم', no: 'لا', back: 'رجوع', next: 'التالي', submit: 'إرسال',
      send: 'إرسال', copy: 'نسخ', copied: 'تم النسخ!', revoke: 'إلغاء', noData: 'لا توجد بيانات.',
      actions: 'الإجراءات', status: 'الحالة', role: 'الدور', stores: 'المتاجر', name: 'الاسم',
      code: 'الرمز', address: 'العنوان', area: 'المنطقة', date: 'التاريخ', note: 'ملاحظة',
      type: 'النوع',
    },
    pages: {
      dashboard: 'لوحة العمليات', submit: 'إرسال تقرير', review: 'مراجعة التقارير',
      stores: 'المتاجر', users: 'المستخدمون والوصول', templates: 'القوالب',
      corrective: 'الإجراءات التصحيحية', photos: 'صفحة الصور', verify: 'التحقق من الصور',
      shifts: 'الورديات', logbook: 'سجل الورديات', profile: 'الملف الشخصي',
    },
    lang: { label: 'اللغة', others: 'أخرى' },
  },

  pt: {
    nav: {
      dashboard: 'Painel', submit: 'Enviar', review: 'Revisar', profile: 'Perfil',
      stores: 'Lojas', users: 'Usuários', templates: 'Modelos', corrective: 'Corretivo',
      photos: 'Fotos', verify: 'Verificar foto', shifts: 'Turnos', logbook: 'Diário',
      signOut: 'Sair',
    },
    auth: {
      subtitle: 'Plataforma de operações de restaurante',
      signIn: 'Entrar', emailLabel: 'Endereço de e-mail', emailPlaceholder: 'voce@exemplo.com',
      sendCode: 'Enviar código →', sending: 'Enviando…', checkEmail: 'Verifique seu e-mail',
      codeSentTo: 'Enviamos um código de 6 dígitos para', codeLabel: 'Código de 6 dígitos',
      verifying: 'Verificando…', signInBtn: 'Entrar', useDifferent: '← Outro e-mail',
      pendingTitle: 'Acesso pendente', pendingBody: 'Sua conta aguarda aprovação.',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: 'Esta tela atualiza automaticamente.',
      waitingBadge: 'Aguardando aprovação',
      rejectedTitle: 'Acesso negado', rejectedBody: 'A solicitação não foi aprovada.',
      rejectedContact: 'Contate o proprietário ou gerente de área.',
      signOut: 'Sair', sendingCode: 'Enviando código…', signingIn: 'Entrando…',
      settingUp: 'Configurando conta…',
    },
    common: {
      save: 'Salvar', cancel: 'Cancelar', edit: 'Editar', delete: 'Excluir',
      approve: 'Aprovar', reject: 'Rejeitar', saving: 'Salvando…', loading: 'Carregando…',
      active: 'Ativo', inactive: 'Inativo', search: 'Buscar', add: 'Adicionar',
      create: 'Criar', update: 'Atualizar', close: 'Fechar', yes: 'Sim', no: 'Não',
      back: 'Voltar', next: 'Próximo', submit: 'Enviar', send: 'Enviar',
      copy: 'Copiar', copied: 'Copiado!', revoke: 'Revogar', noData: 'Sem dados.',
      actions: 'Ações', status: 'Status', role: 'Função', stores: 'Lojas', name: 'Nome',
      code: 'Código', address: 'Endereço', area: 'Área', date: 'Data', note: 'Nota',
      type: 'Tipo',
    },
    pages: {
      dashboard: 'Painel de operações', submit: 'Enviar relatório', review: 'Revisar relatórios',
      stores: 'Lojas', users: 'Usuários e acesso', templates: 'Modelos',
      corrective: 'Ações corretivas', photos: 'Folha de fotos', verify: 'Verificar foto',
      shifts: 'Turnos', logbook: 'Diário de turnos', profile: 'Perfil',
    },
    lang: { label: 'Idioma', others: 'Outros' },
  },

  ru: {
    nav: {
      dashboard: 'Панель', submit: 'Отправить', review: 'Проверить', profile: 'Профиль',
      stores: 'Магазины', users: 'Пользователи', templates: 'Шаблоны', corrective: 'Коррективы',
      photos: 'Фото', verify: 'Проверить фото', shifts: 'Смены', logbook: 'Журнал',
      signOut: 'Выйти',
    },
    auth: {
      subtitle: 'Платформа управления рестораном',
      signIn: 'Войти', emailLabel: 'Электронная почта', emailPlaceholder: 'you@example.com',
      sendCode: 'Отправить код →', sending: 'Отправка…', checkEmail: 'Проверьте почту',
      codeSentTo: 'Мы отправили 6-значный код на', codeLabel: '6-значный код',
      verifying: 'Проверка…', signInBtn: 'Войти', useDifferent: '← Другая почта',
      pendingTitle: 'Ожидание доступа', pendingBody: 'Ваш аккаунт ожидает одобрения.',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: 'Экран обновляется автоматически.',
      waitingBadge: 'Ожидает одобрения',
      rejectedTitle: 'Доступ закрыт', rejectedBody: 'Запрос не был одобрен.',
      rejectedContact: 'Свяжитесь с владельцем или менеджером.',
      signOut: 'Выйти', sendingCode: 'Отправка кода…', signingIn: 'Вход…',
      settingUp: 'Настройка аккаунта…',
    },
    common: {
      save: 'Сохранить', cancel: 'Отмена', edit: 'Редактировать', delete: 'Удалить',
      approve: 'Одобрить', reject: 'Отклонить', saving: 'Сохранение…', loading: 'Загрузка…',
      active: 'Активен', inactive: 'Неактивен', search: 'Поиск', add: 'Добавить',
      create: 'Создать', update: 'Обновить', close: 'Закрыть', yes: 'Да', no: 'Нет',
      back: 'Назад', next: 'Далее', submit: 'Отправить', send: 'Отправить',
      copy: 'Копировать', copied: 'Скопировано!', revoke: 'Отозвать', noData: 'Нет данных.',
      actions: 'Действия', status: 'Статус', role: 'Роль', stores: 'Магазины', name: 'Имя',
      code: 'Код', address: 'Адрес', area: 'Район', date: 'Дата', note: 'Примечание',
      type: 'Тип',
    },
    pages: {
      dashboard: 'Панель операций', submit: 'Отправить отчёт', review: 'Проверить отчёты',
      stores: 'Магазины', users: 'Пользователи и доступ', templates: 'Шаблоны',
      corrective: 'Корректирующие действия', photos: 'Фотогалерея', verify: 'Проверка фото',
      shifts: 'Смены', logbook: 'Журнал смен', profile: 'Профиль',
    },
    lang: { label: 'Язык', others: 'Другие' },
  },

  ja: {
    nav: {
      dashboard: 'ダッシュボード', submit: '提出', review: 'レビュー', profile: 'プロフィール',
      stores: '店舗', users: 'ユーザー', templates: 'テンプレート', corrective: '是正措置',
      photos: '写真シート', verify: '写真確認', shifts: 'シフト', logbook: 'ログ帳',
      signOut: 'サインアウト',
    },
    auth: {
      subtitle: 'レストラン運営管理プラットフォーム',
      signIn: 'サインイン', emailLabel: 'メールアドレス', emailPlaceholder: 'you@example.com',
      sendCode: 'サインインコードを送信 →', sending: '送信中…', checkEmail: 'メールを確認',
      codeSentTo: '6桁のコードを送信しました:', codeLabel: '6桁のコード',
      verifying: '確認中…', signInBtn: 'サインイン', useDifferent: '← 別のメールを使用',
      pendingTitle: 'アクセス保留中', pendingBody: 'アカウントは承認待ちです。',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: '画面は自動的に更新されます。',
      waitingBadge: '承認待ち',
      rejectedTitle: 'アクセス拒否', rejectedBody: 'リクエストが承認されませんでした。',
      rejectedContact: 'オーナーまたはエリアマネージャーにお問い合わせください。',
      signOut: 'サインアウト', sendingCode: 'コード送信中…', signingIn: 'サインイン中…',
      settingUp: 'アカウント設定中…',
    },
    common: {
      save: '保存', cancel: 'キャンセル', edit: '編集', delete: '削除', approve: '承認',
      reject: '却下', saving: '保存中…', loading: '読み込み中…', active: '有効',
      inactive: '無効', search: '検索', add: '追加', create: '作成', update: '更新',
      close: '閉じる', yes: 'はい', no: 'いいえ', back: '戻る', next: '次へ', submit: '提出',
      send: '送信', copy: 'コピー', copied: 'コピーしました!', revoke: '取り消す',
      noData: 'データなし。', actions: 'アクション', status: 'ステータス', role: '役割',
      stores: '店舗', name: '名前', code: 'コード', address: '住所', area: 'エリア',
      date: '日付', note: 'メモ', type: '種類',
    },
    pages: {
      dashboard: '運営ダッシュボード', submit: 'レポート提出', review: 'レポートレビュー',
      stores: '店舗管理', users: 'ユーザーとアクセス', templates: 'テンプレート',
      corrective: '是正措置', photos: '写真シート', verify: '写真確認',
      shifts: 'シフト管理', logbook: 'シフトログ', profile: 'プロフィール',
    },
    lang: { label: '言語', others: 'その他' },
  },

  de: {
    nav: {
      dashboard: 'Dashboard', submit: 'Einreichen', review: 'Überprüfen', profile: 'Profil',
      stores: 'Filialen', users: 'Benutzer', templates: 'Vorlagen', corrective: 'Korrektur',
      photos: 'Fotoblatt', verify: 'Foto prüfen', shifts: 'Schichten', logbook: 'Logbuch',
      signOut: 'Abmelden',
    },
    auth: {
      subtitle: 'Restaurant-Betriebsplattform',
      signIn: 'Anmelden', emailLabel: 'E-Mail-Adresse', emailPlaceholder: 'sie@beispiel.de',
      sendCode: 'Anmeldecode senden →', sending: 'Senden…', checkEmail: 'E-Mail prüfen',
      codeSentTo: 'Wir haben einen 6-stelligen Code gesendet an', codeLabel: '6-stelliger Code',
      verifying: 'Prüfen…', signInBtn: 'Anmelden', useDifferent: '← Andere E-Mail',
      pendingTitle: 'Zugang ausstehend', pendingBody: 'Ihr Konto wartet auf Genehmigung.',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: 'Dieser Bildschirm aktualisiert sich automatisch.',
      waitingBadge: 'Genehmigung ausstehend',
      rejectedTitle: 'Zugang verweigert', rejectedBody: 'Die Anfrage wurde nicht genehmigt.',
      rejectedContact: 'Wenden Sie sich an den Eigentümer oder Gebietsleiter.',
      signOut: 'Abmelden', sendingCode: 'Code senden…', signingIn: 'Anmelden…',
      settingUp: 'Konto einrichten…',
    },
    common: {
      save: 'Speichern', cancel: 'Abbrechen', edit: 'Bearbeiten', delete: 'Löschen',
      approve: 'Genehmigen', reject: 'Ablehnen', saving: 'Speichern…', loading: 'Laden…',
      active: 'Aktiv', inactive: 'Inaktiv', search: 'Suchen', add: 'Hinzufügen',
      create: 'Erstellen', update: 'Aktualisieren', close: 'Schließen', yes: 'Ja', no: 'Nein',
      back: 'Zurück', next: 'Weiter', submit: 'Einreichen', send: 'Senden',
      copy: 'Kopieren', copied: 'Kopiert!', revoke: 'Widerrufen', noData: 'Keine Daten.',
      actions: 'Aktionen', status: 'Status', role: 'Rolle', stores: 'Filialen', name: 'Name',
      code: 'Code', address: 'Adresse', area: 'Gebiet', date: 'Datum', note: 'Notiz',
      type: 'Typ',
    },
    pages: {
      dashboard: 'Betriebsdashboard', submit: 'Bericht einreichen', review: 'Berichte prüfen',
      stores: 'Filialen', users: 'Benutzer & Zugang', templates: 'Vorlagen',
      corrective: 'Korrekturmaßnahmen', photos: 'Fotoblatt', verify: 'Foto prüfen',
      shifts: 'Schichtplan', logbook: 'Schichtlogbuch', profile: 'Profil',
    },
    lang: { label: 'Sprache', others: 'Andere' },
  },

  hi: {
    nav: {
      dashboard: 'डैशबोर्ड', submit: 'सबमिट करें', review: 'समीक्षा', profile: 'प्रोफ़ाइल',
      stores: 'स्टोर', users: 'उपयोगकर्ता', templates: 'टेम्पलेट', corrective: 'सुधारात्मक',
      photos: 'फ़ोटो शीट', verify: 'फ़ोटो सत्यापन', shifts: 'शिफ्ट', logbook: 'लॉगबुक',
      signOut: 'साइन आउट',
    },
    auth: {
      subtitle: 'रेस्तरां संचालन प्लेटफ़ॉर्म',
      signIn: 'साइन इन', emailLabel: 'ईमेल पता', emailPlaceholder: 'you@example.com',
      sendCode: 'साइन-इन कोड भेजें →', sending: 'भेज रहे हैं…', checkEmail: 'अपना ईमेल जांचें',
      codeSentTo: 'हमने 6-अंकीय कोड भेजा', codeLabel: '6-अंकीय कोड',
      verifying: 'सत्यापित हो रहा है…', signInBtn: 'साइन इन', useDifferent: '← अन्य ईमेल',
      pendingTitle: 'पहुँच लंबित', pendingBody: 'आपका खाता अनुमोदन की प्रतीक्षा में है।',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: 'यह स्क्रीन स्वचालित रूप से अपडेट होती है।',
      waitingBadge: 'अनुमोदन की प्रतीक्षा',
      rejectedTitle: 'पहुँच अस्वीकृत', rejectedBody: 'अनुरोध अनुमोदित नहीं हुआ।',
      rejectedContact: 'सहायता के लिए मालिक से संपर्क करें।',
      signOut: 'साइन आउट', sendingCode: 'कोड भेज रहे हैं…', signingIn: 'साइन इन हो रहे हैं…',
      settingUp: 'खाता सेट हो रहा है…',
    },
    common: {
      save: 'सहेजें', cancel: 'रद्द करें', edit: 'संपादित करें', delete: 'हटाएं',
      approve: 'अनुमोदित करें', reject: 'अस्वीकार', saving: 'सहेज रहे हैं…',
      loading: 'लोड हो रहा है…', active: 'सक्रिय', inactive: 'निष्क्रिय', search: 'खोज',
      add: 'जोड़ें', create: 'बनाएं', update: 'अपडेट', close: 'बंद करें', yes: 'हाँ', no: 'नहीं',
      back: 'वापस', next: 'अगला', submit: 'सबमिट', send: 'भेजें', copy: 'कॉपी',
      copied: 'कॉपी हो गया!', revoke: 'रद्द करें', noData: 'कोई डेटा नहीं।',
      actions: 'क्रियाएं', status: 'स्थिति', role: 'भूमिका', stores: 'स्टोर', name: 'नाम',
      code: 'कोड', address: 'पता', area: 'क्षेत्र', date: 'तारीख', note: 'नोट', type: 'प्रकार',
    },
    pages: {
      dashboard: 'संचालन डैशबोर्ड', submit: 'रिपोर्ट सबमिट करें', review: 'रिपोर्ट समीक्षा',
      stores: 'स्टोर', users: 'उपयोगकर्ता और पहुँच', templates: 'टेम्पलेट',
      corrective: 'सुधारात्मक कार्रवाई', photos: 'फ़ोटो शीट', verify: 'फ़ोटो सत्यापन',
      shifts: 'शिफ्ट', logbook: 'शिफ्ट लॉगबुक', profile: 'प्रोफ़ाइल',
    },
    lang: { label: 'भाषा', others: 'अन्य' },
  },

  id: {
    nav: {
      dashboard: 'Dasbor', submit: 'Kirim', review: 'Tinjau', profile: 'Profil',
      stores: 'Toko', users: 'Pengguna', templates: 'Template', corrective: 'Korektif',
      photos: 'Lembar Foto', verify: 'Verifikasi Foto', shifts: 'Shift', logbook: 'Buku Catatan',
      signOut: 'Keluar',
    },
    auth: {
      subtitle: 'Platform operasi restoran',
      signIn: 'Masuk', emailLabel: 'Alamat email', emailPlaceholder: 'anda@contoh.com',
      sendCode: 'Kirim kode masuk →', sending: 'Mengirim…', checkEmail: 'Periksa email Anda',
      codeSentTo: 'Kami mengirim kode 6 digit ke', codeLabel: 'Kode 6 digit',
      verifying: 'Memverifikasi…', signInBtn: 'Masuk', useDifferent: '← Email lain',
      pendingTitle: 'Akses Tertunda', pendingBody: 'Akun Anda menunggu persetujuan.',
      pendingManagerReviewBody: 'Your request is with store managers for identification and pre-approval.',
      pendingPreApprovedBody: 'A store manager has pre-approved your request. Waiting for final approval.',
      pendingNeedsRecheckBody: 'Your request needs another check by a store manager before final approval.',
      pendingNote: 'Layar ini diperbarui otomatis.',
      waitingBadge: 'Menunggu persetujuan',
      rejectedTitle: 'Akses Ditolak', rejectedBody: 'Permintaan tidak disetujui.',
      rejectedContact: 'Hubungi pemilik atau manajer area.',
      signOut: 'Keluar', sendingCode: 'Mengirim kode…', signingIn: 'Masuk…',
      settingUp: 'Menyiapkan akun…',
    },
    common: {
      save: 'Simpan', cancel: 'Batal', edit: 'Edit', delete: 'Hapus', approve: 'Setujui',
      reject: 'Tolak', saving: 'Menyimpan…', loading: 'Memuat…', active: 'Aktif',
      inactive: 'Tidak aktif', search: 'Cari', add: 'Tambah', create: 'Buat', update: 'Perbarui',
      close: 'Tutup', yes: 'Ya', no: 'Tidak', back: 'Kembali', next: 'Selanjutnya',
      submit: 'Kirim', send: 'Kirim', copy: 'Salin', copied: 'Disalin!', revoke: 'Cabut',
      noData: 'Tidak ada data.', actions: 'Tindakan', status: 'Status', role: 'Peran',
      stores: 'Toko', name: 'Nama', code: 'Kode', address: 'Alamat', area: 'Area',
      date: 'Tanggal', note: 'Catatan', type: 'Jenis',
    },
    pages: {
      dashboard: 'Dasbor Operasi', submit: 'Kirim Laporan', review: 'Tinjau Laporan',
      stores: 'Toko', users: 'Pengguna & Akses', templates: 'Template',
      corrective: 'Tindakan Korektif', photos: 'Lembar Foto', verify: 'Verifikasi Foto',
      shifts: 'Jadwal Shift', logbook: 'Buku Catatan Shift', profile: 'Profil',
    },
    lang: { label: 'Bahasa', others: 'Lainnya' },
  },
};

// Merge extended sections (staff/admin/camera) into each language pack
const fullTranslations = Object.fromEntries(
  (Object.keys(translations) as LangCode[]).map((code) => {
    const ext = code === 'vi' ? buildExtendedPack('vi') : buildExtendedPack('en');
    return [code, deepMerge(deepMerge(translations.en, translations[code]), ext) as T];
  }),
) as Record<LangCode, T>;

function resolveT(lang: LangCode): T {
  return deepMerge(fullTranslations.en, fullTranslations[lang] ?? fullTranslations.en);
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface LangCtx {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  t: T;
  isRtl: boolean;
}

const Ctx = createContext<LangCtx>({
  lang: 'en',
  setLang: () => {},
  t: resolveT('en'),
  isRtl: false,
});

const STORAGE_KEY = 'heypelo_lang';

function detectDefault(): LangCode {
  const stored = localStorage.getItem(STORAGE_KEY) as LangCode | null;
  if (stored && translations[stored]) return stored;
  const browser = navigator.language.slice(0, 2).toLowerCase() as LangCode;
  return translations[browser] ? browser : 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(detectDefault);
  const t = useMemo(() => resolveT(lang), [lang]);

  function setLang(l: LangCode) {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    const isRtl = LANGUAGES.find((x) => x.code === l)?.rtl ?? false;
    document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', l);
  }

  // Apply dir/lang on first render
  useEffect(() => {
    const meta = LANGUAGES.find((x) => x.code === lang);
    document.documentElement.setAttribute('dir', meta?.rtl ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const isRtl = LANGUAGES.find((x) => x.code === lang)?.rtl ?? false;

  return (
    <Ctx.Provider value={{ lang, setLang, t, isRtl }}>
      {children}
    </Ctx.Provider>
  );
}

export function useLang() {
  return useContext(Ctx);
}
