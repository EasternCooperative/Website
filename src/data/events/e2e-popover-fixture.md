---
draft: true
title: 'E2E Test Fixture — Popover & Jump Nav'
date: 2099-08-01
endDate: 2099-08-03
startTime: '5:00 PM'
endTime: '3:00 PM'
location: 'Test Venue'
address: '1 Test Lane, Philadelphia, PA 19103'
excerpt: 'Internal fixture for Playwright E2E tests. Not a real event.'
cognitoFormId: '99'
fee: '$25 adults / Free for kids'
classes:
  - name: Folk Dance
    leaders:
      - id: isaac-lebwohl-steiner
    restriction: All ages
    period: Morning
    days: All 3 days
    room: Rec Hall
    description: Intro to international folk dance. No experience needed.
  - name: Singing
    leaders:
      - id: patricia-williams
      - id: judi-powers
    period: Morning
    days: Days 1–2
    room: Music Room
  - name: Drama
    leaders:
      - id: isaac-lebwohl-steiner
      - name: Lane Po
        role: assistant
    period: Afternoon
    days: All 3 days
    room: Theater
  - name: Yoga
    leader: Jane Doe
    restriction: 12+
    period: Afternoon
    days: Day 1
    room: Elm Room
schedule:
  timeslots:
    - label: Morning
      start: '09:00'
      end: '12:00'
    - label: Afternoon
      start: '13:00'
      end: '16:00'
tags:
  - e2e-fixture
---
