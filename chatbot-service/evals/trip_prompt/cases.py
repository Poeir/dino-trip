"""Fixed test requests for the prompt experiment. Chosen to cover the input
space the frontend actually allows (interestList / budgetList / paceList /
areaScopeList in frontend/src/data/seed.js), with a few deliberately hard
cases: a must-go far outside the city, an interest with very few matching
places, no interests at all, and a narrow day window.

Dates are fixed (not "today + n") so opening-hours/weekday behaviour is the
same on every run -- otherwise two runs a week apart would not be comparable.
"""

CASES = [
    {
        "id": "c01_city_culture_relaxed",
        "input": dict(
            trip_duration_days=1, start_date="2026-11-07", accommodation_name="โรงแรมพูลแมน ขอนแก่น",
            accommodation_lat=16.4321, accommodation_lng=102.8253,
            interests=["วัฒนธรรม/ศาสนา"], trip_pace="relaxed", budget_level="ปานกลาง",
            area_scope="เมือง", start_time="09:00", end_time="18:00",
        ),
    },
    {
        "id": "c02_dino_family_2d",
        "input": dict(
            trip_duration_days=2, start_date="2026-11-14", accommodation_name="โรงแรมพูลแมน ขอนแก่น",
            accommodation_lat=16.4321, accommodation_lng=102.8253,
            interests=["ไดโนเสาร์", "ครอบครัว"], trip_pace="standard", budget_level="ปานกลาง",
            area_scope="ทั่วขอนแก่น",
        ),
    },
    {
        "id": "c03_cafe_food_budget",
        "input": dict(
            trip_duration_days=1, start_date="2026-11-08", accommodation_name="ที่พักใกล้ มข.",
            accommodation_lat=16.4746, accommodation_lng=102.8230,
            interests=["คาเฟ่", "อาหารพื้นถิ่น"], trip_pace="standard", budget_level="ประหยัด",
            area_scope="เมือง",
        ),
    },
    {
        "id": "c04_luxury_packed_3d",
        "input": dict(
            trip_duration_days=3, start_date="2026-12-04", accommodation_name="โรงแรมพูลแมน ขอนแก่น",
            accommodation_lat=16.4321, accommodation_lng=102.8253,
            interests=["ธรรมชาติ", "ช้อปปิ้ง/หัตถกรรม", "คาเฟ่"], trip_pace="packed", budget_level="หรูหรา",
            area_scope="ทั่วขอนแก่น", start_time="08:00", end_time="20:00",
        ),
    },
    {
        "id": "c05_must_go_far",
        "input": dict(
            trip_duration_days=2, start_date="2026-11-21", accommodation_name="โรงแรมพูลแมน ขอนแก่น",
            accommodation_lat=16.4321, accommodation_lng=102.8253,
            interests=["ธรรมชาติ"], must_go=["อุทยานแห่งชาติภูเวียง", "บึงแก่นนคร"],
            trip_pace="standard", budget_level="ปานกลาง", area_scope="ทั่วขอนแก่น",
        ),
    },
    {
        "id": "c06_no_interests",
        "input": dict(
            trip_duration_days=1, start_date="2026-11-10", accommodation_name="ที่พักกลางเมือง",
            accommodation_lat=16.4322, accommodation_lng=102.8236,
            interests=[], trip_pace="standard", budget_level="ปานกลาง", area_scope="เมือง",
        ),
    },
    {
        "id": "c07_short_window_shopping",
        "input": dict(
            trip_duration_days=1, start_date="2026-11-12", accommodation_name="ที่พักกลางเมือง",
            accommodation_lat=16.4322, accommodation_lng=102.8236,
            interests=["ช้อปปิ้ง/หัตถกรรม", "อาหารพื้นถิ่น"], trip_pace="relaxed", budget_level="ประหยัด",
            area_scope="เมือง", start_time="13:00", end_time="20:00",
        ),
    },
    {
        "id": "c08_mixed_3d_relaxed",
        "input": dict(
            trip_duration_days=3, start_date="2026-12-10", accommodation_name="โรงแรมพูลแมน ขอนแก่น",
            accommodation_lat=16.4321, accommodation_lng=102.8253,
            interests=["วัฒนธรรม/ศาสนา", "ธรรมชาติ", "อาหารพื้นถิ่น"], must_go=["พระมหาธาตุแก่นนคร"],
            trip_pace="relaxed", budget_level="ปานกลาง", area_scope="ทั่วขอนแก่น",
        ),
    },
]
