#!/usr/bin/env bash
# Generate ElevenLabs voiceover for the "Projects page" tutorial.
#
# Usage:
#   export ELEVENLABS_API_KEY=sk_xxx          # rotate the one you pasted in chat!
#   export ELEVENLABS_VOICE_ID=<voice_id>     # pick an Arabic-capable voice in your library
#   bash scripts/generate-tutorial-audio.sh
#
# Output: ./tutorial-audio/scene-01.mp3 … scene-11.mp3

set -euo pipefail

: "${ELEVENLABS_API_KEY:?Set ELEVENLABS_API_KEY in your env}"
VOICE_ID="${ELEVENLABS_VOICE_ID:-21m00Tcm4TlvDq8ikWAM}"   # default = Rachel; replace with an Arabic voice
MODEL_ID="${ELEVENLABS_MODEL_ID:-eleven_multilingual_v2}" # multilingual_v2 handles Arabic well
OUT_DIR="${OUT_DIR:-./tutorial-audio}"

mkdir -p "$OUT_DIR"

# --- Scenes (Arabic) ---------------------------------------------------------
declare -a SCENES=(
"أهلاً بك. في هذا الفيديو سنتعرّف على صفحة المشاريع، مركز التحكم الرئيسي لإدارة كل مشاريع الوكالة. في الأعلى نرى أربعة مؤشرات سريعة: إجمالي المشاريع، إجمالي المهام، متوسط المهام لكل مشروع، والمشاريع بدون مدير. هذه الأرقام تعطيك صورة فورية عن حجم العمل الحالي."

"أعلى الصفحة ستجد التبويبات الرئيسية: المشاريع، المهام، قوالب المهام، تصنيفات الخدمات، التقارير، والاستيراد. كل تبويب يفتح لك واجهة مخصصة لإدارة هذا الجانب من العمل."

"كل مشروع يظهر في كرت يحتوي على المعلومات الأساسية: اسم المشروع ورمزه التعريفي مثل بي آر جي ٠١٨٢٠، نسبة الإنجاز، الخدمات المرتبطة كإدارة الحسابات والإعلانات والسوشيال ميديا، تاريخ البداية والنهاية، ومدير المشروع ومدير الحساب."

"للوصول السريع إلى مشروع محدد، يمكنك استخدام شريط البحث في الأعلى. اكتب اسم المشروع أو اسم المتجر. وللتصفية المتقدمة استخدم زر الفلتر بجانب البحث."

"يمكنك التبديل بين عرض الكروت وعرض القائمة من الأيقونات في أعلى يمين الصفحة، حسب طريقة العمل المفضلة لديك."

"لإنشاء مشروع جديد، اضغط زر نيو في الأعلى. ستفتح قائمة الإنشاء السريع، والتي تتيح لك إنشاء مشروع، أو تسليم مبيعات، أو قالب مهام، أو تصنيف خدمة. اختر: مشروع جديد."

"معالج إنشاء المشروع يتكون من ثلاث خطوات. في الخطوة الأولى، العميل، اختر العميل من القائمة، أو أضف عميلاً جديداً مباشرة. ثم اكتب اسم المشروع، مثلاً: حملة رمضان ١٤٤٧. اختر الباقة إن وُجدت، وأضف وصفاً مختصراً. لاحظ على اليمين لوحة المعاينة. كل خدمة تضيفها سيظهر فيها المهام التي ستُولَّد تلقائياً."

"في خطوة الخدمات، اختر الخدمات التي يتضمنها المشروع: السوشيال ميديا، الإعلانات الممولة، والسيو. مع كل خدمة تختارها، تظهر المهام المرتبطة بها في لوحة المعاينة، مع تواريخها التلقائية المحسوبة من قوالب المهام."

"في الخطوة الأخيرة، الجدولة والمراجعة، حدّد تاريخ بداية المشروع، وراجع ملخص المهام والمواعيد قبل الحفظ. النظام سيحسب مواعيد التسليم تلقائياً مع احترام أيام العطل الرسمية في التقويم السعودي."

"اضغط حفظ لإنشاء المشروع. سيتم توليد جميع المهام تلقائياً، تعيينها للأشخاص المسؤولين، وإرسال الإشعارات للمعنيين. يمكنك بعد ذلك متابعة المشروع من قائمة المشاريع."

"هكذا يمكنك إدارة كل مشاريع الوكالة من مكان واحد. في الفيديو القادم سنتناول صفحة المهام بالتفصيل. شكراً لمشاهدتك."
)

# --- Generate ----------------------------------------------------------------
for i in "${!SCENES[@]}"; do
  idx=$(printf "%02d" $((i+1)))
  out="$OUT_DIR/scene-$idx.mp3"
  text="${SCENES[$i]}"

  if [[ -f "$out" ]]; then
    echo "✓ scene-$idx.mp3 already exists, skipping"
    continue
  fi

  echo "→ Generating scene-$idx.mp3 (${#text} chars)"

  # Build JSON payload safely with jq
  payload=$(jq -n \
    --arg text "$text" \
    --arg model "$MODEL_ID" \
    '{text: $text, model_id: $model, voice_settings: {stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true}}')

  http_code=$(curl -sS -o "$out" -w "%{http_code}" \
    -X POST "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: audio/mpeg" \
    -d "$payload")

  if [[ "$http_code" != "200" ]]; then
    echo "✗ scene-$idx failed (HTTP $http_code):"
    cat "$out"
    rm -f "$out"
    exit 1
  fi

  echo "  ✓ saved $out ($(du -h "$out" | cut -f1))"
done

echo
echo "Done. All scenes saved to $OUT_DIR/"
echo "Total characters: $(printf '%s' "${SCENES[@]}" | wc -c | tr -d ' ')"
