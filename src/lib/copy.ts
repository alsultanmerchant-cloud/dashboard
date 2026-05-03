// Arabic copy bank — single source of strings shared across the app.
// Keep tone formal-friendly, concise, action-first.

export const copy = {
  app: {
    name: "مركز قيادة الوكالة",
    tagline: "نظام تشغيل داخلي ذكي للوكالة",
  },
  actions: {
    create: "إنشاء",
    save: "حفظ",
    cancel: "إلغاء",
    delete: "حذف",
    edit: "تعديل",
    view: "عرض",
    confirm: "تأكيد",
    submit: "إرسال",
    close: "إغلاق",
    search: "بحث",
    filter: "تصفية",
    clearFilters: "إعادة تعيين",
    refresh: "تحديث",
    next: "التالي",
    previous: "السابق",
    open: "فتح",
    add: "إضافة",
    remove: "إزالة",
    apply: "تطبيق",
    showMore: "عرض المزيد",
    markAllRead: "تعليم الكل كمقروء",
    markRead: "تعليم كمقروء",
    signOut: "تسجيل الخروج",
    backToHome: "العودة إلى الرئيسية",
    retry: "إعادة المحاولة",
  },
  states: {
    loading: "جارٍ التحميل…",
    empty: "لا يوجد بيانات",
    error: "حدث خطأ غير متوقع",
    saved: "تم الحفظ",
    submitted: "تم الإرسال",
    deleted: "تم الحذف",
    notFound: "غير موجود",
  },
  forms: {
    requiredField: "هذا الحقل مطلوب",
    invalidEmail: "بريد إلكتروني غير صالح",
    passwordTooShort: "كلمة المرور قصيرة جدًا",
    pickAtLeastOne: "اختر عنصرًا واحدًا على الأقل",
    placeholderEmail: "name@company.com",
    placeholderSearch: "ابحث…",
    placeholderName: "الاسم الكامل",
    placeholderPhone: "+966 5x xxx xxxx",
    placeholderNotes: "أضف ملاحظاتك…",
  },
  empty: {
    clients: {
      title: "لا يوجد عملاء بعد",
      description: "أضف أول عميل لتبدأ في إنشاء المشاريع وتوزيع المهام على الفريق.",
    },
    projects: {
      title: "لا توجد مشاريع",
      description: "أنشئ مشروعك الأول من العميل المناسب وحدد الخدمات المقدمة.",
    },
    tasks: {
      title: "لا توجد مهام في هذا العرض",
      description: "غيّر التصفية أو أضف مهمة جديدة لتظهر هنا.",
    },
    handovers: {
      title: "لا توجد نماذج تسليم",
      description: "نماذج التسليم من المبيعات تظهر هنا فور إرسالها وتتحول تلقائيًا إلى مشاريع.",
    },
    notifications: {
      title: "لا توجد تنبيهات جديدة",
      description: "ستظهر هنا الإشارات والتسليمات وتحديثات المهام.",
    },
    aiInsights: {
      title: "لم يتم تجميع رؤى بعد",
      description: "مع بدء استخدام النظام ستتراكم الأحداث وتظهر رؤى مفيدة في هذه اللوحة.",
    },
    serviceCategories: {
      title: "لا توجد تصنيفات بعد",
      description: "أضف تصنيفًا أو استورد تصنيفات Odoo لتظهر هنا قوالب المهام المرتبطة.",
    },
    renewalCycles: {
      title: "لا توجد دورات تجديد",
      description: "اضبط جدول التجديد ثم ابدأ دورة جديدة لتُولَّد المهام تلقائيًا.",
    },
    escalations: {
      title: "لا توجد تصعيدات",
      description: "ستظهر هنا التصعيدات الموجَّهة إليك تلقائيًا عند خرق SLA.",
    },
    exceptions: {
      title: "لا توجد استثناءات",
      description: "افتح استثناءً يدويًا من صفحة المهمة عندما يستدعي الموقف ذلك.",
    },
  },
  escalations: {
    kindLabels: {
      client: "عميل",
      deadline: "موعد",
      quality: "جودة",
      resource: "موارد",
    },
    statusLabels: {
      open: "مفتوح",
      acknowledged: "مُقَرّ به",
      closed: "مغلق",
    },
    openException: "فتح استثناء",
    resolveException: "إغلاق الاستثناء",
    acknowledge: "إقرار",
    badgeOpen: "استثناء مفتوح",
  },
  comingNext: {
    title: "قريبًا في المرحلة التالية",
    description: "هذه الوحدة جزء من خطة التطوير اللاحقة. النظام جاهز لاستقبالها فور البدء.",
  },
  errors: {
    boundaryTitle: "حدثت مشكلة غير متوقعة",
    boundaryDescription: "نعتذر عن ذلك. حاول تحديث الصفحة، وإذا تكرر الخطأ تواصل مع مسؤول النظام.",
  },
  notFound: {
    title: "الصفحة غير موجودة",
    description: "الرابط الذي اتبعته لا يقابل أي صفحة في النظام.",
  },
  organization: {
    chartTitle: "هيكل الوكالة",
    chartDescription:
      "العرض الشجري لهيكل سكاي لايت — الأقسام، رؤساء الأقسام، قادة الفرق وأعضاء الفريق.",
    sectionTechnical: "الأقسام التقنية",
    sectionAccountManagement: "إدارة الحسابات",
    sectionMain: "الأقسام الأساسية",
    sectionSupporting: "الأقسام المساندة",
    sectionAdmin: "الإدارة والمساندة",
    sectionSales: "المبيعات والتيلي سيلز",
    head: "رئيس القسم",
    teamLeads: "قادة الفرق",
    members: "أعضاء الفريق",
    noHead: "لم يُعيَّن رئيس قسم بعد",
    noTeamLeads: "لا يوجد قادة فرق",
    noMembers: "لا يوجد أعضاء بعد",
    setHead: "تعيين رئيس القسم",
    addTeamLead: "إضافة قائد فريق",
    removeTeamLead: "إزالة",
    setPosition: "تعيين المنصب",
    positions: {
      head: "رئيس قسم",
      team_lead: "قائد فريق",
      specialist: "متخصص",
      agent: "منفّذ",
      admin: "إداري",
      none: "غير محدد",
    },
    chartEmpty: {
      title: "لم تُهيكل الوكالة بعد",
      description:
        "ابدأ بتعيين رؤساء الأقسام وقادة الفرق لتظهر الشجرة الكاملة.",
    },
    chartError: {
      title: "تعذّر تحميل هيكل الوكالة",
      description:
        "حدث خطأ أثناء قراءة الأقسام والموظفين. حدّث الصفحة، وإذا تكرر الخطأ تواصل مع مسؤول النظام.",
    },
    departmentDetail: {
      backToChart: "العودة إلى الهيكل",
      headSection: "رئيس القسم",
      teamLeadsSection: "قادة الفرق",
      membersSection: "أعضاء القسم",
      adminTools: "أدوات الإدارة",
      pickHead: "اختر رئيسًا للقسم…",
      pickTeamLead: "اختر قائد فريق لإضافته…",
      mustHavePerm:
        "تعديل الهيكل متاح لحاملي صلاحية «تعديل هيكل الوكالة» فقط.",
    },
    salesGated: {
      title: "أقسام المبيعات مخفية حاليًا",
      description:
        "فعّل المفتاح المميّز sales_track_enabled لإظهار قسم المبيعات والتيلي سيلز في الهيكل.",
    },
  },
  featureFlags: {
    pageTitle: "المفاتيح المميّزة",
    pageDescription:
      "تحكم في الوحدات والمسارات الجديدة قبل إطلاقها للجميع. التغيير يسري خلال ثانية واحدة على الطلب التالي.",
    listTitle: "كل المفاتيح",
    columnKey: "المفتاح",
    columnEnabled: "الحالة",
    columnRoles: "الأدوار",
    columnDescription: "الوصف",
    columnUpdated: "آخر تحديث",
    enabled: "مُفعَّل",
    disabled: "مُعطَّل",
    rolesAll: "كل الأدوار",
    rolesAddPlaceholder: "أضف دورًا… (اضغط Enter)",
    saveRoles: "حفظ الأدوار",
    cancelRoles: "إلغاء",
    badgeFlagOff: "هذه الميزة معطّلة حاليًا",
    helpRoles:
      "اترك القائمة فارغة لتفعيل المفتاح لكل من يفي بالشرط، أو حدد أدوارًا معينة لقصره عليها.",
    empty: {
      title: "لا توجد مفاتيح بعد",
      description:
        "ستظهر المفاتيح المعروضة هنا حالما تُضاف وحدات جديدة قابلة للتبديل.",
    },
    error: {
      title: "تعذّر تحميل المفاتيح",
      description:
        "حدث خطأ أثناء قراءة المفاتيح من قاعدة البيانات. حدّث الصفحة، وإذا تكرر الخطأ تواصل مع مسؤول النظام.",
    },
    toggleSuccess: "تم تحديث المفتاح",
    toggleError: "تعذّر تحديث المفتاح",
  },
} as const;
