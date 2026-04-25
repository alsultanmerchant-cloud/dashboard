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
} as const;
