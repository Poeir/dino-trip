# การทดลอง prompt ของ trip planner

เปรียบเทียบ prompt ของ generator (`LLMTripPlanner.generate_prompt`) หลายแบบ ให้คะแนนด้วย LLM judge แยกต่างหาก ร่วมกับ metric แบบ deterministic

## variant ที่ใช้ (exp2)

ทุก variant คือ prompt production จริง แก้เพียงเรื่องเดียวด้วยการ patch ข้อความ (`prompts.py` มี assert กันกรณีที่ prompt จริงถูกแก้แล้ว anchor ไม่ตรง) เพื่อให้บอกได้ว่าความต่างของผลมาจากอะไร

| variant | การเปลี่ยนจาก production |
|---|---|
| `v0_baseline` | prompt ที่ใช้จริง (เรียก `generate_prompt` ตัวจริงตรง ๆ จึงไม่มีทางคลาดจากของจริง) |
| `v1_rules` | เพิ่มกฎ 3 ข้อ: must-go ครบ, ร้านอาหาร 1–2 ต่อวัน, เช็กเวลาเปิด-ปิดกับวันในสัปดาห์ |
| `v2_context` | เพิ่มข้อมูลสถานที่: จำนวนรีวิว, tags (สูงสุด 5), description สั้น (~90 ตัวอักษร ตัดส่วนที่ซ้ำกับชื่อ/อำเภอและ description แม่แบบออก), ธง `[MUST-GO]` |
| `v3_plan_first` | เพิ่มขั้นวางแผนก่อนตอบ ในฟิลด์ `analysis` (จัดกลุ่มตามอำเภอ, ที่ตรงความสนใจ, ธีมรายวัน) |

> exp1 ใช้ชุด variant แรก (`v1_structured`, `v2_plan_first`, `v3_thai_local`) ซึ่งเขียนใหม่ทั้งฉบับและต่างจาก production หลายอย่างพร้อมกัน จึงเลิกใช้ ผลของ exp1 เก็บไว้ใน `runs/exp1/` เฉพาะเป็นแหล่งข้อมูล baseline ที่ใช้ซ้ำใน exp2 และไม่ควรใช้เปรียบเทียบ variant

## ผลสรุป

**รอบสุดท้าย (`runs/final`, 4 variant × 8 เคส × 3 รอบ บนโค้ดหลังแก้ scheduler, pool ที่ freeze ไว้):** ไม่มี variant ไหนผ่านเกณฑ์ที่ล็อกไว้ **คง `v0_baseline` ไว้** (v2 +0.09, v3 +0.11, v1 −0.05 คะแนน ช่วงความเชื่อมั่น 95% ของทุกตัวคร่อม 0 ความต่างน้อยสุดที่ตรวจจับได้ ~0.2) ดู `runs/final/report.md` (อังกฤษ) และ `runs/final/report_th.md` (ไทย)

รอบก่อนหน้า (ใช้เป็นหลักฐานประกอบ ไม่ใช้ตัดสิน): `exp2` เทียบ 4 เคสบนโค้ดก่อนแก้ scheduler ได้ผลเดียวกัน (`runs/exp2/report_th.md`) และ `exp3` ยืนยันว่าการแก้ scheduler/pool (B+C+A) ได้ผลด้วย LLM จริง (3 เคส, เฉพาะ `v0_after`)

## วิธีรัน

```bash
cd chatbot-service
venv\Scripts\python -m evals.trip_prompt.run_eval --run exp2 --reps 3 \
    --variants v0_baseline v2_context v3_plan_first \
    --cases c02_dino_family_2d c03_cafe_food_budget \
    --max-gen-tokens 150000 --max-judge-tokens 75000          # มีค่าใช้จ่าย LLM จริง
venv\Scripts\python -m evals.trip_prompt.report --run exp2      # -> runs/exp2/report.md (ไม่เรียก LLM)
```

ตัวเลือก:
- `--variants`, `--cases`, `--reps` เลือกขอบเขตการรัน
- `--max-gen-tokens`, `--max-judge-tokens` เพดานงบ token ของ generator และ judge (หยุดเริ่มงานใหม่เมื่อถึง; งานที่กำลังรันอยู่ ≤ จำนวน worker จะรันต่อจนจบ)
- `--workers` (ค่าเริ่มต้น 2), `--gen-model`, `--judge-model` (หรือ env `EVAL_JUDGE_MODEL`), `--refresh-cache`
- `--mode loop` รันแบบครบระบบ production (judge ในลูป + regenerate) ใช้ยืนยัน variant ที่ผ่านเกณฑ์แล้ว

ถ้ารันคำสั่งเดิมซ้ำ ระบบจะทำต่อจากจุดเดิม และข้ามงานที่สำเร็จไปแล้ว การนำผลของ run เก่ามาใช้ซ้ำทำได้โดยคัดลอกบรรทัดใน `results.jsonl` ไปไว้ใน run ใหม่ (ทำได้เฉพาะเมื่อ prompt ของ variant นั้นและ rubric ของ judge ไม่เปลี่ยน)

## หลักการออกแบบ

- **candidate pool ถูก cache ไว้ต่อเคส** (`cache/`) ทุก variant และทุกรอบจึงได้ข้อมูลชุดเดียวกัน
- **โหมด `single` (ค่าเริ่มต้น)** เรียก generate ครั้งเดียว ไม่มี judge ในลูป เพราะทั้งลูป regenerate และ scheduler (cap/backfill/gap-filler) คอยซ่อมผลลัพธ์ที่ไม่ดี ถ้าเปิดไว้จะกลบความต่างระหว่าง prompt
- **judge สำหรับประเมินแยกจาก judge ในลูป** (`eval_judge.py`) ใช้โมเดลคนละตระกูลกับ generator (ค่าเริ่มต้น `claude-sonnet-5.5`) ไม่รู้ว่าผลมาจาก variant ไหน มองเห็น candidate pool ด้วย ให้คะแนนจำนวนเต็ม 1–5 ใน 5 เกณฑ์ที่มี anchor กำกับ (`interest_fit`, `constraint_fit`, `variety_flow`, `day_coherence`, `selection_quality`) โดยเขียน critique ก่อนให้คะแนน และไม่ตัดสินเวลา/ระยะทาง/ลำดับ เพราะ scheduler เป็นเจ้าของส่วนนั้น
- **metric แบบ deterministic**
  - วัดจาก output ดิบของ LLM ก่อนถูกซ่อม ได้แก่ ID ผิด/ซ้ำ, ขาด must-go, เกิน cap, meal_role ผิด, เลือกที่ที่ปิดวันนั้น, จำนวนอำเภอต่อวัน
  - วัดจากตัวเลือกของ LLM (`metrics.py` คำนวณจาก output ที่เก็บไว้ ใช้กับผลเก่าได้): interest match, rating เฉลี่ย, จำนวนที่ที่รีวิว < 20
  - วัดจาก itinerary สุดท้าย: สัดส่วนที่ LLM เลือกแล้วรอดถึงแผนจริง, free-time slot, must-go ที่หายไป

## เกณฑ์ตัดสิน (report.py)

report ออกแบบสำหรับการทดลองขนาดเล็ก ตัวตัดสินหลักจึงเป็นชนะ/เสมอ/แพ้ต่อเคส ส่วน paired bootstrap CI และค่าความต่างน้อยสุดที่ตรวจจับได้ (MDE) แสดงควบคู่เพื่อให้เห็นความไม่แน่นอนจริง (CI ใช้ติดป้าย confirmed/tentative เท่านั้น ไม่ใช่เกณฑ์เพิ่ม):

- เทียบเฉพาะเคสที่ **ทุก variant มีข้อมูลครบ** เฉลี่ยรอบของเคสเดียวกันก่อน แล้วถือ "เคส" เป็นหน่วย
- error จาก infrastructure (โควตา/401/เครือข่าย) แสดงแยก ไม่นับเป็นความผิดของ variant ส่วน error ของ variant เอง (เช่น JSON พังหลัง retry) นับ
- ความต่างน้อยกว่า noise floor (ความแกว่งของ baseline เอง อย่างน้อย 0.15 คะแนน) นับเป็นเสมอ
- เลือก variant ใหม่ก็ต่อเมื่อผ่าน **ทุกข้อ**: (a) ค่าเฉลี่ยสูงกว่า baseline ≥ noise floor (b) ชนะมากกว่าแพ้ (c) ไม่แพ้เคสใดเกิน 0.4 (d) hard violation ไม่เกิน baseline + 0.25 (e) must-go ที่หายในแผนสุดท้ายไม่แย่กว่า baseline (f) ไม่มีรันที่ล้มเหลวเอง
- ถ้าไม่มี variant ไหนผ่าน ให้คง baseline หรือรวมจุดเด่นเป็น variant ใหม่แล้วรันเพิ่ม
- ผลจากเคสน้อย (≤ 4) ถือเป็นข้อเสนอ ควรยืนยันด้วย `--mode loop` หรือรอบเพิ่มก่อนใช้จริง

## รอบสุดท้าย: โปรโตคอลที่ล็อกไว้ก่อนรัน

เกณฑ์ ตัววัด และเกณฑ์ตัดสินของรอบสุดท้ายอยู่ใน [`PROTOCOL.md`](PROTOCOL.md) (ล็อกเมื่อ 2026-10-07) เครื่องมือที่รองรับ (ทั้งหมดไม่เรียก LLM):

| ไฟล์ | หน้าที่ |
|---|---|
| `freeze.py` | ดึง candidate pool ครั้งเดียวเป็นแท็ก `_final` ตั้งเป็น read-only เก็บ SHA-256 ใน `cache/manifest_final.json` พร้อม provenance (git commit, จำนวนไฟล์ที่ยังไม่ commit, fingerprint ของไฟล์ที่กำหนดพฤติกรรม) |
| `run_eval.py --pool-tag _final` | ตรวจ hash ก่อนเริ่ม ถ้า pool เปลี่ยนจะไม่รัน และไม่อนุญาต `--refresh-cache` บันทึก pool_tag และ provenance ลง `config.json` |
| `stats.py` | paired bootstrap สองชั้น (seed คงที่), MDE, Spearman |
| `report.py` | เพิ่ม 95% CI, MDE, pass rate ตามระดับข้อจำกัด (Environment / Hard / Commonsense ตาม Xie et al. 2024), ตรวจ verbosity bias และความสอดคล้องของ judge กับตัวตรวจโค้ด |

```bash
venv\Scripts\python -m evals.trip_prompt.freeze --tag _final --verify     # ตรวจว่า pool ไม่เปลี่ยน
venv\Scripts\python -m evals.trip_prompt.run_eval --run final --pool-tag _final --reps 3 \
    --max-gen-tokens 130000 --max-judge-tokens 120000   # มีค่าใช้จ่าย LLM จริง ต้องได้รับอนุมัติก่อน
venv\Scripts\python -m evals.trip_prompt.report --run final
```

`rejudge.py` ใช้เมื่อ generate สำเร็จแต่ judge ล้ม (เช่น โควตา claude หมด): สร้าง itinerary กลับจาก `llm_output` ที่เก็บไว้ ตรวจว่าตรงกับของเดิมทุกจุด แล้วส่งให้ judge อย่างเดียว ไม่เรียก generator ซ้ำ (`--dry-run` ตรวจอย่างเดียวโดยไม่เรียก LLM) `run_eval` จะข้ามรันกลุ่มนี้เองและเตือนให้ใช้ `rejudge`

```bash
venv\Scripts\python -m evals.trip_prompt.rejudge --run final --pool-tag _final --max-judge-tokens 170000
```

ข้อควรรู้จากรอบ final: (1) โควตาของหลายคีย์ที่ออกให้ผู้ใช้เดียวกันถูกนับรวมกัน คีย์เพิ่มไม่ได้ให้โควตาเพิ่มเสมอไป ควรดู `Tokens used` ของแต่ละคีย์ก่อนวางแผน (2) ต้องระบุ `--variants` ชัดเจนหรือใช้ค่าเริ่มต้น (ตอนนี้ตัด alias `v0_after` ออกแล้ว) มิฉะนั้นจะรัน baseline ซ้ำ (3) ค่า judge ต่อรันของแต่ละเคสคงที่ทุก variant (judge เห็น pool + แผนเท่านั้น) ส่วนค่า generate ของ v2/v3 สูงกว่า baseline 20–30% (v3 เพิ่ม completion ราว 2.5 เท่า)

`report.py` อ่าน `pool_tag` จาก `config.json` ของ run (run เก่าที่ไม่มีให้ระบุ `--pool-tag` เอง) ตั้ง `PYTHONIOENCODING=utf-8` ถ้า console เป็น cp874 เพื่อให้พิมพ์ได้

## ทดสอบ scheduler ซ้ำจาก output ของ LLM ที่เก็บไว้ (ไม่มีค่าใช้จ่าย LLM)

`scheduler_replay.py` นำ `llm_output` ที่เก็บไว้ใน `runs/*/results.jsonl` มารันผ่านฝั่ง deterministic (cap, ลำดับ, backfill, gap filler) ซ้ำ ใช้วัดการแก้ scheduler/pool แบบก่อน-หลังบน input เดียวกัน:

```bash
venv\Scripts\python -m evals.trip_prompt.scheduler_replay --save before     # ก่อนแก้
# ...แก้ scheduler...
venv\Scripts\python -m evals.trip_prompt.scheduler_replay --compare before  # หลังแก้ + รายชื่อรันที่แย่ลง
```

ข้อควรระวัง: replay เฉพาะการ generate รอบแรก ระบบจริงอาจ regenerate ตามผลตอบกลับของ scheduler ตัวเลขสัมบูรณ์จึงเป็นขอบบนของที่ผู้ใช้เห็น ใช้ดู "ความต่างก่อน-หลัง" เป็นหลัก

เปรียบเทียบ pool คนละแบบด้วย `--pool-tag` (สร้างด้วย `load_case_context(case, refresh=True, cache_tag="_a")` ซึ่งเก็บแยกจาก cache เดิม): แต่ละรันของ LLM ถูกเลือกจาก pool เก่า ดังนั้น replay บน pool ใหม่ใช้วัดได้เฉพาะส่วน deterministic (ตัวเลือกร้านสำรอง, การจัดเวลา) ส่วนที่ LLM จะเลือกต่างไปเมื่อเห็น pool ใหม่ ต้องรันจริงเท่านั้น

> cache ใน `cache/` สร้างไว้ตอนต้น ข้อมูลใน DB เปลี่ยนไปแล้วบางส่วน (เช่น c03/c04/c07 มีสถานที่ที่ไม่ใช่ร้านอาหารต่างจากปัจจุบัน) ถ้าจะรัน LLM ใหม่ ควรใช้ `--refresh-cache` ก่อน
